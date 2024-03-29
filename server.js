// Written by Filipe Laborde, Nov 2019
// MIT License - use as you wish!
//
// we are using socket.io to add reconnection logic & namespaces
// see: https://socket.io/docs/
// namespaces: https://socket.io/docs/rooms-and-namespaces/#Namespaces

const express = require("express");
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const mongoose = require("mongoose");
const passwordHash = require('password-hash');
const multer = require('multer'); // for image-upload


const PORT = process.env.PORT || 3000

// config express 
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
// app-facing data served from
app.use(express.static("client"));

// for image uploading we use multer middle-ware.
const Resize = require('./Resize');
const upload = multer({ limits: { fileSize: 50000000 } });

// for the websocket we also need to explicitly listen to 80.
server.listen(PORT);
// WARNING: app.listen(PORT) not needed, it will not allow the websocket layer

mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost/whatsthat", {
  useNewUrlParser: true,
  useFindAndModify: false
});
const db = require("../models");

// Register the user (if new/unique) and save picture to system (if exists)
app.post('/api/register', upload.single('pic'), async function (req, res) {
  console.log( `[POST register] registered user` );
  let filename = '_profile.png';
  if( req.file ){
    // picture attached, resize it and save it for this user
    console.log( `~ pic attached (pic: ${req.file.originalname}/${req.file.size}) ` );
    const fileUpload = new Resize({ path: '/client/assets/pics', size: '300x300' });
    filename = await fileUpload.save(req.file.buffer);
  }
  
  const userData = {
    name: req.body.name,
    email: req.body.email,
    // hash the password to prevent us from knowing actual user password
    password: passwordHash.generate(req.body.password),
    name: req.body.name,
    birthday: req.body.birthday,
    thumbnail: `/assets/pics/${filename}`,
    chatroom: 'Lobby'
    // room, session are added when they login
  }
  const dbUser = await db.User.create( userData );

  res.send( { status: 1, userData: userDataWithoutPassword(dbUser) } );
});

// login user if valid password, pass back the userId + room
app.post('/api/login', async function (req, res) {
  console.log( `[GET login] check user valid`, req.body );
  let dbUser = await db.User.findOne({ email: req.body.email });
  const dbUserPassword = dbUser.password;
  dbUser = userDataWithoutPassword(dbUser);
  console.log( ` .. login user info returned: `, dbUser );

  if( !passwordHash.verify( req.body.password, dbUserPassword ) ){
    console.log( `x sorry invalid password (${req.body.password}), failing.` );
    res.status(401).send({ status: 0, error: "Invalid login, try again" });
  }
  
  // get active chatroom participants (ie have a session too)
  const chatroom = dbUser.chatroom;
  const chatroomUsers = await db.User.find({ chatroom, session: { $size: 32 } }, 'name thumbnail');

  // update everyone with this new person
  socket.emit(`room:${chatroom}`, { action: 'joined', user: userRoomInfo(dbUser) });
  
  res.send( { status: 1, userData: dbUser, chatroomUsers } );
});

app.post('/api/chat', async function (req, res) {
  console.log( `[POST chat] posting to room `)
});

// Switch user between chatrooms
// session: user session | chatroom: old chatroom | gotoChatroom: new chatroom
app.get('/api/chatroom', async function (req, res) {
  // switch this users chatroom
  if( !req.params.session || req.params.session.length !== 32 ){
    res.status(401).send({ status: 0, error: "Invalid session, login again" });
  }

  let dbUser = await db.User.updateOne({ session: req.params.session }, 
    { chatroom: req.params.gotoChatroom });
  console.log( `~ updated user to the new chatroom.`, dbUser );

  // announce to new chatroom & old chatroom
  socket.emit(`room:${gotoChatroom}`, { action: 'joined', 
              user: userRoomInfo(dbUser) } );
  socket.emit(`room:${chatroom}`, { action: 'left', 
              user: userRoomInfo(dbUser) });
  res.send( { status: 1, userData: dbUser, chatroomUsers } );
});


app.post("/api/transaction", async (req, res) => {
  console.log( `[POST transaction]`, req );
  const dbTransaction = await ChatLog.create(body);
  res.json(dbTransaction);
});

app.post("/api/transaction/bulk", async ({ body }, res) => {
  console.log( `[POST transaction/bulk]`, body );
  // mongo uses _id as it's unique-key, it DROPS/IGNORES the 'id' sent to it
  // so we have to gather those id elements 
  const dbTransaction = await ChatLog.insertMany(body);

  let offlineIds = [];
  for( let tx of dbTransaction )
  offlineIds.push( tx.offlineId );

  console.log( ` sending back offlineIds: `, offlineIds );

  // push back the list of offlineId's that we have sync'd.
  res.send({offlineIds: offlineIds});
});

app.get("/api/transaction", async (req, res) => {
  const dbTransaction = await ChatLog.find({}).sort({ date: -1 });
  console.log( `[GET transaction] listing all transactions`, dbTransaction );
  res.json(dbTransaction);
});


// on new connections, send them an initialization
io.on('connection', function (socket) {
  socket.emit('news', { hello: 'world' });
  socket.on('my other event', function (data) {
    console.log(data);
  });
});

 
// general functions used ----------------------
function userDataWithoutPassword( user ){
  delete user.password;
  return user;
}
function userRoomInfo( user ){
  return { _id: user._id, user: user.name, thumbnail: user.thumbnail };
}
