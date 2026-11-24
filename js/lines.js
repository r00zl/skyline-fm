// Everything Mack (live commentary) and Nova (the DJ) can say.
// {curly} words are filled in from what is actually happening in the run.

export const MACK = {
  welcome: [
    'We are live from the rooftops. {name} is at the start line and looking loose.',
    'Good {daypart}, skyline. {name} steps up. The clock starts on the first stride.',
    'Welcome back to the roof. Whenever you are ready, {name}.',
    'Clear sky, fresh legs, and {name} on the line. Mack here with every step of it.',
  ],
  runStart: [
    'And {name} is away!',
    'Clock is running!',
    'Off the line. No turning back now.',
    'Here we go!',
  ],
  vault: [
    'Clean over the top.', 'Tidy vault.', 'Up and over, never broke stride.',
    'That air con unit never stood a chance.', 'Hand down, legs through, gone.',
  ],
  gap: [
    'Clears the gap.', 'Light on the feet.', 'Easy as stepping off a kerb.', 'Across, no drama.',
  ],
  bigJump: [
    '{dist} metres across! Huge.',
    'That is a {dist} metre leap. Somebody measure it.',
    'Flying! {dist} metres of nothing underneath.',
    'I make that {dist} metres. Outrageous.',
  ],
  climb: [
    'Hauls up onto the ledge.', 'Hands on, up and over.', 'Strong pull.', 'Up they go.',
  ],
  clutch: [
    'By the fingertips! {name} just holds on.',
    'Caught it! Barely. I had my eyes closed.',
    'That was nearly a very long way down. Got the ledge.',
    'Clutch grab! The crowd, which is me, goes wild.',
  ],
  wallrun: [
    'On the wall!', 'Running the billboard like it is a pavement.', 'Gravity, please hold.',
    'Sideways and loving it.', 'Advertising space, well used.',
  ],
  wallrunFirst: [
    'First wall-run of the day, and it sticks!',
    'There it is! Feet on the billboard, nothing underneath.',
  ],
  walljump: [
    'Kicks off the wall!', 'Wall to wall!', 'Pinball stuff. Off one and onto the next.',
    'Springs off the panel. Beautiful.',
  ],
  wallkick: [
    'Runs straight up it.', 'One extra step up the wall. Cheeky.', 'Up the face of it!',
  ],
  slide: [
    'Down and sliding.', 'Slide, and keeps every bit of that speed.', 'Knees on the gravel. Worth it.',
  ],
  slideUnder: [
    'Under the duct with centimetres to spare.', 'Limbo! Head stays attached.',
    'Low bridge, no problem.', 'Ducks the ductwork. Sorry.',
  ],
  roll: [
    'Rolls it out. Textbook.', 'Tucks, rolls, straight back to speed.',
    'A {drop} metre drop, and they roll through like it is nothing.',
    'That is how you land. Shoulder, hip, gone.',
  ],
  hardLanding: [
    'Oof. Felt that one up here in the commentary box.',
    'Heavy landing. The knees will be filing a complaint.',
    'No roll! That costs time.',
    'Flat feet from {drop} metres. Ouch.',
  ],
  spring: [
    'Onto the springboard and up!', 'Launch pad! {name} is airborne.', 'Up like a champagne cork.',
  ],
  combo3: ['Three in a row. Starting to flow.', 'That is a chain. Three moves linked.', 'Linking them up now.'],
  combo5: ['Five move combo! {name} is cooking.', 'Five linked. This is getting good.', 'Five, without a breath.'],
  combo8: ['Eight! Eight moves in one chain.', 'Eight linked. Somebody stop them. Actually, do not.'],
  combo12: ['Twelve move combo. I am running out of adjectives.', 'A dozen! That is ridiculous flow.'],
  combo20: ['Twenty. Twenty linked moves. I am just going to sit quietly and watch.'],
  comboBreak: [
    'And the chain breaks at {combo}.', 'There goes the combo. {combo} moves, gone.', 'Flow, interrupted.',
  ],
  fall: [
    'And down they go.', 'Oh no. That is a long way down.', '{name} has left the building. Literally.',
    'Missed it! Back to the checkpoint.', 'Gravity wins that round.', 'That is a fall. We will take that again.',
    'Not like that. Definitely not like that.',
  ],
  fallRepeat: [
    'That is {n} at the same spot. The gap is not getting any smaller, {name}.',
    'Fall number {n} here. I admire the persistence.',
    'Same place, same result. Try a longer run-up.',
    '{n} now. The pigeons are starting to place bets.',
  ],
  splat: [
    'That was not a landing. That was an arrival.',
    'Too far, too fast. Nobody rolls out of that.',
  ],
  checkpointFirst: ['Checkpoint. {cp}, in {split}.', 'Through {cp} at {split}.'],
  checkpointAhead: [
    '{cp}, and {name} is {delta} up on their best!',
    'Green split! {delta} ahead at {cp}.',
    '{delta} quicker than the best run through {cp}.',
  ],
  checkpointBehind: [
    '{cp}. {delta} down on the best. Time to push.',
    'Through {cp}, {delta} behind. Still all to play for.',
  ],
  speed: [
    '{kmh} kilometres an hour, on foot.',
    'Clocked at {kmh}. That is a speeding ticket outside a school.',
    'Look at the pace! {kmh} on the gun.',
  ],
  idle: [
    '{name} appears to be admiring the view.', 'We are still live, by the way.',
    'Take your time. It is not as if there is a clock. Oh, wait.', 'Stretching? Thinking? Having a moment?',
  ],
  backwards: ['Wrong way! The helipad is behind you, {name}.', 'I do not think the course goes that way.'],
  zone: {
    ducts: ['Low ductwork ahead. Slide under it.', 'Here come the ducts. Stay low.'],
    wallrun: ['The billboard. The only way across is along it.', 'No roof for ten metres. Use the wall.'],
    alley: ['Billboard alley. Left wall, right wall, do not look down.', 'Two walls and a long drop. Wall to wall, {name}.'],
    spring: ['Springboard coming up. Hit the orange pad.', 'Orange pad ahead. It only goes one way: up.'],
    drop: ['Big drop ahead. Roll the landing or pay for it.', 'Seven and a half metres down. Tuck and roll.'],
    beams: ['The crane beams. One metre wide, and a long way down either side.', 'Balance now. Three beams, no railings.'],
    climb: ['Now the stack. Three ledges and a wall.', 'Time to climb. Up the steps, then the big one.'],
    finale: ['Last leg! It is a straight sprint to the helipad.', 'Four roofs to go. Empty the tank, {name}!'],
  },
  finish: ['{name} hits the helipad! {time}. What a run.', 'And that is the finish! {time} on the clock.'],
  finishPB: [
    'New personal best! {time}, that is {delta} quicker than ever before!',
    'It is a record! {time}! Put that on the billboard.',
  ],
  finishFirst: ['First finish on the board. {time}. Now go and beat it.'],
  finishClean: ['No falls! A clean run in {time}.'],
  finishFalls: ['Home in {time}, with {falls} unscheduled trips to street level.'],
  station: [
    'Changing the station mid-run. Bold.', 'New station. Let us see if it makes them faster.',
    'Ah, a {station} listener.',
  ],
  phone: ['Phone is out. I hope that is important.', 'Checking the phone. Mid-run. On a roof.'],
  restart: ['Back to the top. Fresh clock.', 'From the start again. Reset the board.'],
};

export const NOVA = {
  signOn: [
    'This is Skyline FM, 98.6, broadcasting from somewhere above the ninth floor. I am Nova. {name}, this run is for you.',
    'You are locked to Skyline FM. Nova here, keeping you company all the way to the helipad.',
    'Good {daypart}, rooftops. It is {clock}, the sky is clear, and I have music. Nova with you on Skyline FM.',
  ],
  ident: [
    'Skyline FM. Higher than every other station. Literally.',
    '98.6, Skyline FM. Music for people who take the stairs two at a time.',
    'Skyline FM, the only station you can hear from the roof.',
  ],
  houseIntro: [
    'From the house band, this is {track} by {artist}.',
    'Here is {artist} with {track}. Turn it up.',
    'Something to run to. {track}, from {artist}.',
    '{artist} now, and a tune called {track}.',
    'Next up on Skyline FM: {track}. That is {artist}.',
  ],
  houseOutro: [
    'That was {track}, by {artist}.',
    '{artist} there, with {track}.',
  ],
  spotifyIntro: [
    'Now playing on {station}: {track}.',
    'This one is called {track}. Good running music.',
    '{track}, coming through loud on {station}.',
  ],
  spotifyIntroArtist: [
    'Here is {artist} with {track}.',
    'On {station} right now, {track} by {artist}.',
    '{artist}. {track}. You are welcome.',
  ],
  spotifyNoTitle: ['Fresh track on {station}. Let us go.', 'New song, same rooftops.'],
  tuneSpotify: [
    'Handing you over to {station}, straight from Spotify. I will still be here between the songs.',
    'Switching the feed to {station}. Nova stays on the mic.',
    '{station} it is. Good choice.',
  ],
  tuneHouse: ['Back to the house band, here on Skyline FM.', 'Home again. Skyline FM, 98.6.'],
  needsTap: ['The stream is ready. Open your phone and tap play, and I will take it from there.'],
  shoutFalls: [
    'A quick hello to the pavement, which has now met {name} {falls} times.',
    'Travel news: watch for falling runners near the billboards. {falls} so far today.',
  ],
  shoutCombo: [
    'Word from the commentary box is that {name} just chained {combo} moves. Show-off. Keep going.',
    'A {combo} move combo up there. I felt the building wobble.',
  ],
  shoutSpeed: ['I am told {name} hit {kmh} kilometres an hour. On foot. Hydrate.'],
  shoutClean: ['No falls yet for {name}. I am saying nothing. I do not want to jinx it.'],
  timeCheck: [
    'It is {clock} on a {day}, and you are spending it running across rooftops. Good choice.',
    'Time check: {clock}. Weather: breezy at altitude, visibility excellent.',
    'Not a cloud worth mentioning. Perfect roof weather.',
  ],
  dedication: [
    'This next one goes out to {name}, currently climbing back up the stairs.',
    'For everyone who has ever misjudged a gap. {name}, I am looking at you.',
  ],
  finish: [
    'And that is the helipad. {time} for {name}. Stay up here as long as you like; the music is free.',
    'Run complete, {time}. I would clap, but I am holding a fader.',
  ],
  finishPB: ['A new best for {name}! I am playing something loud to celebrate.'],
};
