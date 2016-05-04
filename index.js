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

//messenger api token

var handleMessage = require('./helpers').handleMessage;

app.set('port', (process.env.PORT || 8080));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.get('/', function(req, res) {
    res.send('Hello, I am a chatbot!');
});

app.get('/webhook/', function(req, res) {
    if (req.query['hub.verify_token'] === 'location_me') {
        res.send(req.query['hub.challenge'])
    }
    res.send('Error, wrong token');
});


app.post('/webhook/', handleMessage);

app.listen(app.get('port'), function() {
    console.log('running on port', app.get('port'))
});
