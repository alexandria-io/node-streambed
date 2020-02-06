require('dotenv').config();
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const youtubeUpload = require('../insert/uploads.js');
const analytics = require('../insert/analytics.js');
const ipfs = require('../ipfs/addVideoIpfs');
const Thumbler = require('thumbler');
const getPercentage = require('../src/helpers/GetPercentage');

const client = require('../client.js');
const url = require('url');
const User = require('../task-manager/src/models/user');

let videoInfo = {};

// Set Storage of uploaded video or file on the server
let storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, './public/uploads');
  },
  filename: function(req, file, cb) {
    cb(null, 'video' + path.extname(file.originalname));
  }
});

let upload = multer({
  storage: storage
});

const thumbler = (time, callback) => {
  let thumb = Thumbler(
    {
      type: 'video',
      input: videoInfo.videoFilePath,
      output: './public/uploads/thumb.jpg',
      time: time,
      size: '300x200' // this optional if null will use the dimentions of the video
    },
    function(err, path) {
      if (err) return err;
      return callback();
    }
  );
};

//Runs async addFile function to get hash for ipfs
const getIpfsHash = async () => {
  let link = await ipfs
    .addFile(videoInfo)
    .then((data) => {
      console.log('ipfs data: ', data);
      console.log('https://ipfs.io/ipfs/' + data);
      return data;
    })
    .catch(console.err);
  return link;
};

const youtubeupload = async (req, res) => {
  try {
    const uploaded = await youtubeUpload
      .runUpload(videoInfo)
      .then((data) => {
        return data;
      })
      .catch((err) => console.log(err));
    return uploaded;
  } catch (e) {
    console.log(e);
    return 'Syntax Error';
  }
};

router.post('/uploaded', upload.single('myFiles'), (req, res) => {
  console.log('req body: ', req.body.body);
  const body = req.body.body;
  const file = req.file;
  videoInfo.title = body[0];
  videoInfo.desc = body[1];
  videoInfo.videoFilePath = './' + file.path;
  videoInfo.videoFileName = file.filename;
  videoInfo.imgFilePath = './public/uploads/thumb.jpg';
  videoInfo.imgFileName = 'thumb.jpg';

  getPercentage.fileDuration(videoInfo.videoFilePath, 25).then((seconds) => {
    let time = '';

    let differenceInMinutes = seconds / 60;

    if (differenceInMinutes < 1) {
      time = getPercentage.seconds(differenceInMinutes);
    } else if (differenceInMinutes >= 1 && differenceInMinutes < 60) {
      time = getPercentage.minutes(differenceInMinutes);
    } else if (differenceInMinutes >= 60) {
      time = getPercentage.hours(differenceInMinutes);
    }
    console.log(videoInfo.videoFilePath, 'time: ', time);
    //Grabs thumbnail from video and saves it
    thumbler(time, () => {
      res.render('dashboard', {
        title: 'Streambed'
      });
    });
  });
});

router.get('/uploaded', (req, res) => {
  res.send([videoInfo]);
});

/* Sending data back to React componant for upload route */
router.get('/upload', (req, res) => {
  res.render('dashboard', { token: accessToken });
});

/* GET login page. */
router.get('/', function(req, res, next) {
  const { userId } = req.session;

  //If session id exist skips login / signup page and back to the users dashboard
  if (userId) {
    res.redirect('/users/login');
  } else {
    res.render('index', { title: 'Streambed' });
  }
});

/* GET analytics page. */
router.get('/analytics', function(req, res, next) {
  analytics
    .runVideoAnalytics()
    .then((data) => {
      console.log('the video Analytic result: ', data);
      res.send({ data });
    })
    .catch(console.err);
});

/* POST route for video file up to youtube*/
router.post('/upload-youtube', async (req, res) => {
  let keys = Object.keys(req.body);

  if (keys.length === 2) {
    youtubeupload()
      .then((data) => {
        getIpfsHash().then((link) => {
          data.ipfs = link;
          console.log('data ', data);
          res.send(data);
        });

        console.log('index.js youtube callback: ', data);
      })
      .catch((err) => err.message);
  } else {
    youtubeupload()
      .then((data) => {
        res.send(data);
      })
      .catch((err) => err.message);
  }
});

router.get('/upload-youtube', (req, res) => {
  res.send([videoInfo]);
});

/*******Logout route */
router.post('/logout', async (req, res) => {
  res.removeHeader('Authorization');
  res.clearCookie(req.session);
  req.session.destroy((err) => {
    if (err) console.log(err);
    res.redirect('/');
  });
});
/*******Logout route end*/

//! ****************** Oauth routes made from refactoring **********************//

const scopes = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube'
];

/* After OAuth routes to /dashboard to update token into header */
router.post('/youtube-auth', (req, res) => {
  client.authenticate(scopes, req.session.userId).then((data) => {
    console.log(data.authorizeUrl);
    let token = data.credentials.access_token;
    access_token = token;
    res.header('authorization', token);
    res.status(200).json({ url: data.authorizeUrl });
  });
});

router.get('/oauth2callback', async (req, res) => {
  console.log(client);
  console.log(req.session);
  const qs = new url.URL(req.url, process.env.APP_URL).searchParams;
  const { tokens } = await client.oAuth2Client.getToken(qs.get('code'));
  console.log(qs);
  //   this.oAuth2Client.credentials = tokens;
  //   resolve(this.oAuth2Client);

  client.oAuth2Client.setCredentials(tokens);

  /** This saves the rT to the db, userId is not accessible from the server so I sent it from when you click the youtube check box**/
  /** UserId is used look up the logged in user and save the rT**/
  console.log('YOYOYOYOYO', client.oAuth2Client.userId);

  if (tokens.refresh_token) {
    User.findOneAndUpdate(
      { _id: client.oAuth2Client.userId },
      { $set: { rT: tokens.refresh_token } }
    )
      .then(() => {
        console.log('Line 93 Clientjs');
        return res.redirect('/');
      })
      .catch((err) => console.log(err));
  }
});

//! ****************** Oauth routes made from refactoring **********************//

module.exports = router;
