BladeArtFight

Draw your beyblade. Your drawing becomes the blade. Then it fights for you.

A browser game where the blade you draw with your finger determines your
stats -- and an autonomous physics battle decides who gets the stadium.

### [fast open](https://aomsinjaroensuk15-stack.github.io/BladeArtFight/)
Inspired by those 3D spinning-top battle videos. Everything is procedural:
no art assets, no build step, one HTML file + JS.

How to play

1. Draw a blade (top-down view) inside the circle.
2. Watch the stat bars react live while you draw.
3. Press FIGHT! and watch your blade battle a bot blade in the arena.
4. Last top standing (with HP and spin left) wins.

Your art IS your build

What you draw	What it becomes	
More ink / bigger shape	More HP (mass = tanky)	
Spiky, jagged outline	More ATK (circularity ratio of the perimeter)	
Symmetric design	Better spin retention (loses spin slower)	
Off-center scribble	Wobble -- drifts unpredictably, burns spin	

So a fat blob is a tank, a 6-pointed star is a glass cannon, and a
carefully mirrored shape spins forever but might not hit hard.

Run it

Needs internet (Matter.js loads from CDN). Either:

- Open `index.html` in any browser, or
- Host free on GitHub Pages (recommended, plays great on phones)

Deploy to GitHub Pages

```bash
# from the project folder (Termux works fine)
git init
git add .
git commit -m "BladeArtFight v1"
gh repo create BladeArtFight --public --source=. --push
```

Then on github.com: Settings -> Pages -> Deploy from a branch -> main -> Save.
Your game goes live at `https://<your-username>.github.io/BladeArtFight/`.

Tech

- Vanilla JS + [Matter.js](https://brm.io/matter-js/) physics (top-down, gravity off)
- Pixel-level canvas analysis for stat extraction (`stats.js`)
- Circular arena from static segment ring, sprite rendering of your drawing
- WebAudio synth hit sounds (no audio files)

Roadmap

- Pass-and-play: both players draw a blade
- Tap-to-boost during battle
- Blade gallery (save/load your designs, localStorage)
- Elemental effects & camera shake
- Local leaderboard (longest win streak)

License

MIT -- draw wild.
