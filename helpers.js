var geocode = require('google-geocode');
geocode.setApiKey(process.env.GOOGLE_GEOCODE_APIKEY);

var mongoose = require('mongoose');
var User = require('./user');
var request = require('request');
var token = process.env.MESSENGER_TOKEN;
var apiAiToken = process.env.APIAI_TOKEN;


var apiAi = require('apiai');
var apiAiApp = apiAi(apiAiToken);

var Nbrite = require('nbrite');
var nbrite = new Nbrite({ token: process.env.EVENTBRITE_TOKEN });

function handleMessage(req, res) {
    messaging_events = req.body.entry[0].messaging;
    for (i = 0; i < messaging_events.length; i++) {
        var event = req.body.entry[0].messaging[i]
        const sender = event.sender.id;
        User.findOne({ sender: sender }, function(err, user) {
            if (err) throw err;
            if (!user) createUserRecord(sender);
            if (event) {
                if (event.message && event.message.text) {
                    var query = apiAiApp.textRequest(event.message.text);
                    query.on('response', function(response) {
                        console.log(response);
                        determineStage(user, response);
                    });
                    query.on('error', function(error) {
                        console.log(error);
                    });
                    query.end();
                } else if (event.postback) {
                    handlePostback(user.status, sender, user.categories[0], event.postback);
                }
            }
        });
    }
    res.sendStatus(200);
}


function handlePostback(status, sender, categories, postback, url) {
    if (status === STATES.RECEIVED_LOCATION) {
        locationPostback(sender, categories, postback);
    } else if (postback.payload.indexOf('DESCRIBE') > -1) {
        nbrite.events(getIdFromPostback(postback.payload)).info(function(err, info) {
            const message = formatLargeMessage(info.description.text);
            if (message.length > 1) {
                for (var i = 0; i < message.length; i++) {
                    if ((i + 1) >= message.length) {
                        sendMessage(sender, {
                            "attachment": {
                                "type": "template",
                                "payload": {
                                    template_type: "button",
                                    "text": message[i] + '...',
                                    "buttons": [{
                                        "type": "web_url",
                                        "url": info.url,
                                        "title": "Event Page"
                                    }]
                                }
                            }
                        });
                    } else {
                        sendMessage(sender, message[i]);
                    }
                }
            } else {
                sendMessage(sender, message[0]);
            }
        });
    }
}

function determineStage(user, response) {

    const status = user.status;
    const sender = user.sender;
    const categories = user.categories;
    const action = response.result.action;
    const parameters = (response.result.parameters) ? response.result.parameters : undefined;

    if (status === STATES.INITIAL) {
        if (action != USER_ACTIONS.LOCATION_SET) {
            initialStart(sender);
        } else if (action === USER_ACTIONS.LOCATION_SET) {
            receivedUserLocation(parameters.q, sender);
        }
    } else if (action === USER_ACTIONS.EVENTS_UPDATE) {
        const changeTo = parameters.change_to;
        updateUser(sender, { categories: [STATES.SELECTED_CATEGORY, changeTo] });
        promiseSendMessage(sender, `Nice choice! I'll be sure to show you ${changeTo} events from now on.`)
            .then(sendMessage(sender, `Ask me for events to see your updated recommendations.`));
    } else if (action === USER_ACTIONS.LOCATION_UPDATE) {
        if (parameters.q === '') {
            sendMessage(sender, `Tell me where you'd like to change your location to!`);
        } else {
            receivedUserLocation(parameters.q, sender);
        }
    } else if (categories[0] === STATES.SELECTED_CATEGORY && action === USER_ACTIONS.EVENTS_SEARCH) {
        if (parameters.event_type) {
            promiseSendMessage(sender, `These are some events that you may like!`)
                .then(findEventAndParse(sender, parameters.event_type, user.location.lat.toString(), user.location.lng.toString())) // meme
        } else {
            promiseSendMessage(sender, `These are some events that you may like based on your preference of ${user.categories[1]}.`)
                .then(findEventAndParse(sender, user.categories[1], user.location.lat.toString(), user.location.lng.toString())) // meme
        }
    } else if (status === STATES.LOCATION_CONFIRMED && action === USER_ACTIONS.EVENTS_SEARCH) {
        if (user.categories.length === 0) {
            getUserCategories(sender);
        } else if (user.categories[0] === STATES.SELECTING_CATEGORY) {
            promiseSendMessage(sender, `Cool. ${parameters.event_type} are fun!`)
                .then(updateUser(sender, { categories: [STATES.SELECTED_CATEGORY, parameters.event_type] }))
                .then(findEventAndParse(sender, parameters.event_type, user.location.lat.toString(), user.location.lng.toString()));
        }
    } else if (parameters) {
        if (parameters.simplified === USER_ACTIONS.HELLO) {
            sendMessage(sender, response.result.fulfillment.speech);
        }
    } else if (parameters && parameters.simplified === USER_ACTIONS.WHO_ARE_YOU) {
        sendMessage(sender, CONVERSATIONS.ABOUT_SCOUT);
    } else {
        sendMessage(sender, "I'm not sure how to respond to that. Ask me to find you an event, and I'll do that. Anything else? Nah. If you need some help, just enter \"Help\".")
    }
}


function locationPostback(sender, category_selected, postback) {
    switch (postback.payload) {
        case STATES.LOCATION_CORRECT:
            updateUser(sender, { status: STATES.LOCATION_CONFIRMED });
            if (category_selected != STATES.SELECTED_CATEGORY) {
                promiseSendMessage(sender, 'Cool!')
                    .then(function(response) {
                        if (response) getUserCategories(sender)
                    });
            } else {
                sendMessage(sender, `Gotcha.`);
            }
            break;
        case STATES.LOCATION_INCORRECT:
            updateUser(sender, { status: STATES.INITIAL });
            sendMessage(sender, 'Welp. Okay where do you currently live?');
            break;
        default:
            break;
    }
}

function receivedUserLocation(location, sender) {
    geocode.getGeocode(location, function(data) {
        console.log(data);
        const response = JSON.parse(data).results[0];
        const location = response.formatted_address;
        const geoLocation = response.geometry.location;
        var confirm = {
            attachment: {
                "type": "template",
                "payload": {
                    "template_type": "button",
                    "text": `Did you mean ${location}?`,
                    "buttons": [{
                        "type": "postback",
                        "title": "YES",
                        "payload": STATES.LOCATION_CORRECT
                    }, {
                        "type": "postback",
                        "title": "NO",
                        "payload": STATES.LOCATION_INCORRECT
                    }]
                }
            }
        }
        updateUser(sender, { location: geoLocation, locationString: location, status: STATES.RECEIVED_LOCATION });
        sendMessage(sender, confirm);
    }, function(err) {
        console.log("error " + err);
    });

}

function findEventAndParse(sender, category, lat, lng) {
    var cards = [];
    nbrite.get('/events/search/', { q: category, 'location.latitude': lat, 'location.longitude': lng, popular: true, 'sort_by': 'best' }, function(err, allEvents) {
        for (var i = 0; i < 10; i++) {
            if (allEvents.events[i]) {
                cards.push({
                    "title": allEvents.events[i].name.text,
                    "subtitle": allEvents.events[i].description.text,
                    "image_url": (allEvents.events[i].logo) ? allEvents.events[i].logo.url : '',
                    "buttons": [{
                        "type": 'web_url',
                        "url": allEvents.events[i].url,
                        "title": 'Event Page'
                    }, {
                        "type": 'postback',
                        "title": 'Short Description',
                        "payload": `DESCRIBE_${allEvents.events[i].resource_uri}`
                    }]
                });
            }
        }
        const data = {
            "attachment": {
                "type": "template",
                "payload": {
                    "template_type": "generic",
                    "elements": cards
                }
            }
        }
        sendMessage(sender, data);
    });
}


function getUserCategories(sender) {
    sendMessage(sender, `Tell me what type of event you'd like to attend! For example, you could type "Conferences", "Food" or "Technology".`);
    updateUser(sender, { categories: [STATES.SELECTING_CATEGORY, ''] });
}


function createUserRecord(sender) {
    var newUser = new User({
        sender: sender
    });
    newUser.save();
    initialStart(sender);

}

function updateUser(sender, set) {
    User.update({ sender: sender }, { $set: set }, function(err) {
        if (err) throw err;
    });

}

function initialStart(sender) {
    sendMessage(sender, "Hi there! Let's get started. Tell me your location to discover events near you!");
}

function confirmLocation(sender, city, location) {
    sendMessage(sender, `Cool! Did you mean ${city}?`)

}

function getIdFromPostback(payload) {
    return payload.replace(/[^\w\s]/gi, '').split('events')[1];
}

function formatLargeMessage(str) {
    return str.match(/.{1,320}/g).slice(0, 2);
}


function promiseSendMessage(sender, data) {
    return new Promise(function(resolve, reject) {
        if (typeof(data) === 'string') {
            messageData = {
                text: data
            }
        } else {
            messageData = data;
        }

        request({
            url: 'https://graph.facebook.com/v2.6/me/messages',
            qs: { access_token: token },
            method: 'POST',
            json: {
                recipient: { id: sender },
                message: messageData,
            }
        }, function(error, response, body) {
            if (error || response.body.error) {
                reject(error, response.body.error);
            } else {
                setTimeout(resolve(response.body), 1000);
            }
        });

    });
}

function sendMessage(sender, data) {
    if (typeof(data) === 'string') {
        messageData = {
            text: data
        }
    } else {
        messageData = data;
    }
    request({
        url: 'https://graph.facebook.com/v2.6/me/messages',
        qs: { access_token: token },
        method: 'POST',
        json: {
            recipient: { id: sender },
            message: messageData,
        }
    }, function(error, response, body) {
        if (error) {
            console.log('Error sending messages: ', error)
        } else if (response.body.error) {
            console.log('Error: ', response.body.error)
        }
    })
}


var CONVERSATIONS = {
    ABOUT_SCOUNT: `I'm a sloth that finds you cool events to attend.`
}

var STATES = {
    INITIAL: 'INITIAL',
    RECEIVED_LOCATION: 'RECEIVED_LOCATION',
    LOCATION_CORRECT: 'LOCATION_CORRECT',
    LOCATION_INCORRECT: 'LOCATION_INCORRECT',
    LOCATION_CONFIRMED: 'LOCATION_CONFIRMED',
    SELECTING_CATEGORY: 'SELECTING_CATEGORY',
    SELECTED_CATEGORY: 'SELECTED_CATEGORY'
}

var USER_ACTIONS = {
    LOCATION_UPDATE: 'maps.update',
    LOCATION_SET: 'maps.search',
    HELLO: 'hello',
    WHO_ARE_YOU: 'who are you',
    EVENTS_SEARCH: 'events.search',
    EVENTS_UPDATE: 'change.events'
}

module.exports = {
    handleMessage
}
