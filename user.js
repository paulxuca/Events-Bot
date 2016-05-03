var mongoose = require('mongoose');

var userSchema = new mongoose.Schema({
	sender: Number,
	status: {type: String, default: 'INITIAL'},
	location: {
		lat:Number,
		lng: Number
	},
	locationString: String,
	categories: [String]
});

var User = mongoose.model('User', userSchema);

module.exports = User;