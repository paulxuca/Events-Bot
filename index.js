var express = require('express');

//body PARSER
var bodyParser = require('body-parser');

//request.js init
var request = require('request');

//express app init
var app = express();
var mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI);
mongoose.connection.on('error', function() {
    console.log('MongoDB Connection Error. Please make sure that MongoDB is running.');
    process.exit(1);
});


var geocode = require('google-geocode');
geocode.setApiKey(process.env.GOOGLE_GEOCODE_APIKEY);


//messenger api token
var token = process.env.MESSENGER_TOKEN;
var apiAiToken = process.env.APIAI_TOKEN;


var apiAi = require('apiai');
var apiAiApp = apiAi(apiAiToken);

var User = require('./user');


app.set('port', (process.env.PORT || 8080));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());



var STATES = {
    INITIAL: 'INITIAL',
    RECEIVED_LOCATION: 'RECEIVED_LOCATION',
    LOCATION_CORRECT: 'LOCATION_CORRECT',
    LOCATION_INCORRECT: 'LOCATION_INCORRECT',
    LOCATION_CONFIRMED: 'LOCATION_CONFIRMED'
}

app.get('/', function(req, res) {
    res.send('Hello, I am a chatbot!');
});

app.get('/webhook/', function(req, res) {
    if (req.query['hub.verify_token'] === 'location_me') {
        res.send(req.query['hub.challenge'])
    }
    res.send('Error, wrong token');
});


function determineStage(user, response) {
    if (user.status === STATES.INITIAL) {
        if (response.result.action != 'maps.search') {
            console.log('INITIAL STAGE');
            initialStart(user.sender);
        } else if (response.result.action === 'maps.search') {
            console.log('USER SENT LOCATION.');
            receivedUserLocation(response.result.parameters.q, user.sender);
        }
    } else if (response.result.parameters.simplified === 'who are you') {
        sendMessage(user.sender, `I'm a sloth that finds you cool events to attend.`);
    }else if (response.result.action === 'maps.update') {
    	receivedUserLocation(response.result.parameters.q, user.sender);
    } else if (user.status === STATES.LOCATION_CONFIRMED) {
        if (user.categories.length === 0) {
            getUserCategories(user.sender);
        } else {

        }

    } else {
        sendMessage(user.sender, "I'm not sure how to respond to that. If you need some help, just enter \"Help\".")
        console.log('Indeterminant Stage.');
    }
}

app.post('/webhook/', function(req, res) {
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
                    if (user.status === 'RECEIVED_LOCATION') {
                        locationPostback(sender, event.postback);
                    }
                }
            }
        });
    }
    res.sendStatus(200);
});

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
                        "payload": "LOCATION_CORRECT"
                    }, {
                        "type": "postback",
                        "title": "NO",
                        "payload": "LOCATION_INCORRECT"
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
    var selection;
    switch (postback.payload) {
        case 'LOCATION_CORRECT':
            sendMessage(sender, 'Cool!');
            selection = true;
            updateUser(sender, { status: STATES.LOCATION_CONFIRMED });
            getUserCategories(sender);
            break;
        case 'LOCATION_INCORRECT':
            selection = false;
            sendMessage(sender, 'Welp. Okay where do you currently live?');
            break;
        default:
            console.log('something went wrong.');
            break;
    }
    if (selection === false) {
        updateUser(sender, { status: STATES.INITIAL });
    }
}



function getUserCategories(sender) {
    sendMessage(sender, `Tell me what type of events you'd like to attend! For example, you could type "Conferences", "Food" or "Technology".`);

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

app.listen(app.get('port'), function() {
    console.log('running on port', app.get('port'))
});
