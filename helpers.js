var geocode = require('google-geocode');
geocode.setApiKey(process.env.GOOGLE_GEOCODE_APIKEY);

var mongoose = require('mongoose');
var User = require('./user');
var request = require('request');
var token = process.env.MESSENGER_TOKEN;
var apiAiToken = process.env.APIAI_TOKEN;


var apiAi = require('apiai');
var apiAiApp = apiAi(apiAiToken);

var ebrite = require('nbrite');
var eventBrite = new ebrite(process.env.EVENTBRITE_TOKEN);



function handleMessage(req, res) {
    messaging_events = req.body.entry[0].messaging
    for (i = 0; i < messaging_events.length; i++) {
        event = req.body.entry[0].messaging[i]
        sender = event.sender.id
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
                    if (user.status === STATES.RECEIVED_LOCATION) {
                        locationPostback(sender, event.postback);
                    }
                }
            }
        });
    }
    res.sendStatus(200);
}

function determineStage(user, response) {

    const status = user.status;
    const action = response.result.action;
    const parameters = response.result.parameters;
    const sender = user.sender;

    if (status === STATES.INITIAL) {
        if (action != 'maps.search') {
            console.log('INITIAL STAGE');
            initialStart(sender);
        } else if (action === 'maps.search') {
            console.log('USER SENT LOCATION.');
            receivedUserLocation(parameters.q, sender);
        }
    } else if (action === 'maps.update') {
        if (parameters.q === '') {
            sendMessage(sender, `Tell me where you'd like to change your location to!`);
        } else {
            receivedUserLocation(parameters.q, sender);
        }
    } else if (status === STATES.LOCATION_CONFIRMED && action === 'events.search') {
        if (user.categories.length === 0) {
            getUserCategories(sender);
        } else if (user.categories[0] === STATES.SELECTING_CATEGORY) {
            updateUser(sender, { categories: [STATES.SELECTED_CATEGORY, parameters.event_type] });
            sendMessage(sender, `Cool. ${parameters.event_type} are fun!`); // This is where to handle categories
        }
    }else if(parameters.simplified === 'hello'){
        sendMessage(sender, response.result.fulfillment.speech);
    } else if (parameters.simplified === 'who are you') {
        sendMessage(sender, `I'm a sloth that finds you cool events to attend.`);
    } else {
        sendMessage(sender, "I'm not sure how to respond to that. If you need some help, just enter \"Help\".")
        console.log('Indeterminant Stage.');
    }
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

function receivedUserLocation(location, sender) {
    geocode.getGeocode(location, function(data) {
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



function locationPostback(sender, postback) {
    switch (postback.payload) {
        case STATES.LOCATION_CORRECT:
            updateUser(sender, { status: STATES.LOCATION_CONFIRMED });
            asyncSendMessage(sender, 'Cool!').then(function(response) {
                getUserCategories(sender);
            });
            break;
        case STATES.LOCATION_INCORRECT:
            updateUser(sender, { status: STATES.INITIAL });
            sendMessage(sender, 'Welp. Okay where do you currently live?');
            break;
        default:
            console.log('something went wrong.');
            break;
    }
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

function asyncSendMessage(sender, data) {
    if (typeof(data) === 'string') {
        messageData = {
            text: data
        }
    } else {
        messageData = data;
    }
    return new Promise(function(resolve, reject) {
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
                resolve(response.body);
            }
        });
    });
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

module.exports = {
    handleMessage
}
