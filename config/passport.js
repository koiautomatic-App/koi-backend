// config/passport.js
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');
const config = require('./index');

const initPassport = () => {
  passport.use(new GoogleStrategy({
    clientID: config.GOOGLE_CLIENT_ID,
    clientSecret: config.GOOGLE_CLIENT_SECRET,
    callbackURL: `${config.BASE_URL}/auth/google/callback`,
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value?.toLowerCase();
      if (!email) return done(new Error('Google no devolvió email'));
      
      let user = await User.findOne({ $or: [{ googleId: profile.id }, { email }] });
      
      if (!user) {
        user = await User.create({
          googleId: profile.id,
          email,
          nombre: profile.name?.givenName || '',
          apellido: profile.name?.familyName || '',
          avatar: profile.photos?.[0]?.value || ''
        });
      } else {
        if (!user.googleId) user.googleId = profile.id;
        user.avatar = profile.photos?.[0]?.value || user.avatar;
        user.ultimoAcceso = new Date();
        await user.save();
      }
      
      done(null, user);
    } catch (e) {
      done(e);
    }
  }));

  passport.serializeUser((user, done) => done(null, user.id));
  
  passport.deserializeUser(async (id, done) => {
    try {
      const user = await User.findById(id).select('-password');
      done(null, user);
    } catch (e) {
      done(e);
    }
  });
};

module.exports = { initPassport };