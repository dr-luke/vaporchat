var chat_server = null;
var chat_client = null;

$( document ).ready(function() {
	console.log('Ready');
	$('#start_host').on('click', function(){
		var password = $('#host_password').val();
		chat_server = new ChatServer(options={'password': password, 
		'onStart': function(server){
			$('#host_id').val(server.server_id);
		},
		'onStatusChange': function(message){
			$('#chat_log').val($('#chat_log').val() + "\nSERVER STATUS CHANGE: " + message);
		},
	})});
	$('#start_client').on('click', function(){
		var password = $('#host_password').val();
		var server_id = $('#host_id').val();
		chat_client = new ChatClient(options={
			'password': password,
			'server_id': server_id,
			'onMessage': function(message){
				$('#chat_log').val($('#chat_log').val() + "\n" + message);
			},
			'onNicknameSet': function(nickname){
				$('#nickname').val(nickname);
			},
			'onConnect': function(client){
				client.nickname($('#nickname').val());
				console.log('TESTING');
			},
		})});
	$('#chat_log').val('');
	$('#host_password').val('');
	$('#host_id').val('');
	$('#nickname').val('Nick_' + random_id(4));
	$('#nickname').on('change', function(){
		chat_client.nickname($('#nickname').val());
	});
	$('#send_message').on('click', function(){
		chat_client.send_message($('#chat_input').val());
		$('#chat_input').val('');
	});
});

class ChatServer {
	constructor(options={}){
		if (!options.name) options.name = "Server " + random_id(6);
		if (!options.password) options.password = random_id(12);
		if (!options.key) options.key = CryptoJS.SHA256(options.password);
		if (!options.onStart) options.onStart = function(){console.log('Connected')};
		if (!options.onStatusChange) options.onStatusChange = function(message){console.log("Server Status", message)};
		this.options = options

		// For Callbacks
		var this_server = this;

		this.participants = [];

		this.server_id = null;

		this.server = new Peer();
		this.server.on('open', function(id) {
			this_server.server_id = id;
			options.onStatusChange('Server ID is ' + id);
			options.onStart(this_server);
		});

		this.server.on('connection', function(conn) {
			options.onStatusChange('New Connection ' + conn.peer)
			this_server.participants.push(new Participant(this_server, conn));
		});
	}

	send_to_all(data){
		for (let i = 0; i < this.participants.length; i++) {
			this.participants[i].send(data);
		} 
	}
}

class Participant {
	constructor(server, conn, options={}){
		if (!options.name) options.name = "nick_" + random_id(4);
		this.options = options

		this.messages = [];

		var this_participant = this;

		this.server = server;
		this.conn = conn;

		this.conn.on('data', function(data) {
			this_participant.on_message(data);
		});

		this.send({
			'type': 'command',
			'method': 'set_nickname',
			'nickname': this.options.name
		});
	}

	on_message(data){
		var data = JSON.parse(data);
		var content = JSON.parse(decrypt_data(data['content'], data['iv'], this.server.options.key));
		this.messages.push(content);

		if (content['type'] == "message"){
			this.server.send_to_all({
				'type': 'message',
				'message': content['message'],
				'from': this.options.name
			});
		} else if (content['type'] == 'command') {
			if (content['method'] == "set_nickname"){
				this.options.name = content['nickname'];
				this.send({
					'type': 'message',
					'message': "Successfully Changed Nickname to: " + this.options.name,
					'from': "SERVER"
				});
				this.send({
					'type': 'command',
					'method': 'set_nickname',
					'nickname': this.options.name
				});
			} else if (content['method'] == "get_nickname"){
				this.send({
					'type': 'command',
					'method': 'set_nickname',
					'nickname': this.options.name
				});
			} else {
				this.send({
					'type': 'message',
					'message': "Unknown Method: " + content['method'],
					'from': "SERVER"
				});
			}
		} else {
			throw Error("Unknown Content Type")
		}
	}

	send(data){
		var iv = get_iv()
		this.conn.send(JSON.stringify({
			'iv': iv,
			'content': encrypt_data(JSON.stringify(data), iv, this.server.options.key)
		}));
	}
}

class ChatClient {
	constructor(options={}){
		if (!options.nickname) options.nickname = "Nick" + random_id(4);
		if (!options.onConnect) options.onConnect = function(client){console.log('Connected to Server!', client)};
		if (!options.onMessage) options.onMessage = function(message){console.log('Message', message)};
		if (!options.onNicknameSet) options.onMessage = function(nickname){console.log('Nickname changed', nickname)};
		if (!options.server_id){
			throw Error('Must Pass Server ID!')
		}
		if (!options.password) options.password = random_id(12);
		if (!options.key) options.key = CryptoJS.SHA256(options.password);
		this.options = options
		var this_chat_client = this;

		this.client = new Peer();
		this_chat_client.client.on('open', function(id) {
			this_chat_client.server = this_chat_client.client.connect(options.server_id);
			this_chat_client.server.on('open', function() {
				options.onConnect(this_chat_client);
			  });
			  this_chat_client.server.on('data', function(data) {
				this_chat_client.receive(data);
			});
		});
	}

	receive(data){
		var data = JSON.parse(data);
		var content = JSON.parse(decrypt_data(data['content'], data['iv'], this.options.key));
		if (content['type'] == 'message') {
			options.onMessage(content['from'] + ': ' +  content['message'])
		} else if (content['type'] == 'command') {
			if (content['method'] == 'set_nickname') {
				this.options.nickname = content.nickname;
				this.options.onNicknameSet(content.nickname);
			}
		} else {
			console.log(content);
		}
	}

	send(data){
		var iv = get_iv()
		this.server.send(JSON.stringify({
			'iv': iv,
			'content': encrypt_data(JSON.stringify(data), iv, this.options.key)
		}));
	}

	send_message(message){
		this.send({'type': 'message', 'message': message});
	}

	nickname(nickname=null) {
		if (nickname) {
			this.send({'type': 'command', 'method': 'set_nickname', 'nickname': nickname});
		} else {
			this.send({'type': 'command', 'method': 'get_nickname'});
			return this.options.nickname;
		}
	}
}


function encrypt_data(data, iv, key){
	data=data.slice();
	encryptedString = CryptoJS.AES.encrypt(data, key, {
		iv: iv,
		mode: CryptoJS.mode.CBC,
		padding: CryptoJS.pad.Pkcs7
	});
	return encryptedString.toString();
}

function decrypt_data(encrypted, iv, key){
	var decrypted = CryptoJS.AES.decrypt(encrypted, key, {
		iv: iv,
		mode: CryptoJS.mode.CBC,
		padding: CryptoJS.pad.Pkcs7
	});
    return decrypted.toString(CryptoJS.enc.Utf8)
}

/**
 * Generate a random id from the given length, and return the result
 * @param {integer} length - Set number of characters for generated id
*/
function random_id(length) {
	var result = '';
	var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	var charactersLength = characters.length;
	for ( var i = 0; i < length; i++ ) {
		result += characters.charAt(Math.floor(Math.random() * charactersLength));
	}
	return result;
}

function get_iv(length=32) {
	return CryptoJS.enc.Base64.parse(random_id(length));
}

/**
 * Remove an Item from a list once
 * @param {array} arr - the list/array you want to remove from
 * @param {value} value - the value you want to remove
*/
function removeItemOnce(arr, value) {
	var index = arr.indexOf(value);
	if (index > -1) {
		arr.splice(index, 1);
	}
	return arr;
}


/**
 * Remove ALL Items from a list
 * @param {array} arr - the list/array you want to remove from
 * @param {value} value - the value you want to remove
*/
function removeItemAll(arr, value) {
	var i = 0;
	while (i < arr.length) {
		if (arr[i] === value) {
		arr.splice(i, 1);
		} else {
			++i;
		}
	}
	return arr;
}


/**
 * Convert Text to Title
 * @param {string} str - String to Turn Into Title
*/
function toTitle(str) {
	return str.replace(/(^|\s)\S/g, function(t){
		return t.toUpperCase()
	});
}

/**
 * Convert Text to Title - Router
 * @param {string} str - String to Turn Into Title
*/
String.prototype.toTitle = function() {
	return toTitle(this);
}


/**
 * Convert Slug to Title
 * @param {string} str - String to Turn Into Title
 * @param {string} divider="_" - Slug Dividing Char
*/
function slugToTitle(str, divider="_") {
	return str.replace(divider, " ").toTitle()
}

/**
 * Convert Slug to Title - Router
 * @param {string} str - String to Turn Into Title
 * @param {string} divider="_" - Slug Dividing Char
*/
String.prototype.slugToTitle = function(divider="_") {
	return slugToTitle(this, divider);
}
