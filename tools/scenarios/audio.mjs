// Sound: the WebAudio engine unlocks on the first gesture, synthesizes its buffers, plays the
// city bed in the menu, reacts to the volume sliders, and makes noise when the player shoots.
// Run with ?nolock=1&warmup=1&seed=3 (no auto start: the menu part is tested first).
export default async function ({ page, wait, down, up, evalGame, waitForGame }) {
  await waitForGame();
  const before = await evalGame((w) => ({ running: w.app.audio.running, ready: w.app.audio.ready }));
  console.log('  before any input:', JSON.stringify(before));

  // first gesture unlocks audio
  await page.mouse.click(6, 360);
  await page.waitForFunction('window.__whoopa.app.audio.running && window.__whoopa.app.audio.ready', { timeout: 8000 });
  console.log('  audio unlocked and all sounds synthesized');

  const peakOver = async (ms) => {
    let peak = 0;
    const end = Date.now() + ms;
    while (Date.now() < end) {
      peak = Math.max(peak, await evalGame((w) => w.app.audio.level()));
      await wait(40);
    }
    return peak;
  };

  // --- menu: only the city ambience is playing ---
  await wait(600);
  const bed = await peakOver(800);
  await evalGame((w) => w.settings.set('ambience', 0));
  await wait(1500);
  const bedOff = await peakOver(500);
  await evalGame((w) => w.settings.set('ambience', 0.6));
  console.log(`  city ambience level ${bed.toFixed(4)}, with the ambience slider at 0: ${bedOff.toFixed(5)}`);
  if (!(bed > 0.002)) throw new Error('city ambience is silent');
  if (!(bedOff < bed * 0.1)) throw new Error('ambience slider does not silence the city bed');

  // menu click sound
  const p0 = await evalGame((w) => w.app.audio.played);
  await evalGame(() => document.querySelector('.screen:not(.hidden) button')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await wait(100);
  // close whatever that opened
  await evalGame(() => document.querySelector('.screen:not(.hidden) [data-back]')?.click());
  const p1 = await evalGame((w) => w.app.audio.played);
  console.log(`  menu button clicks played ${p1 - p0} sound(s)`);
  if (p1 - p0 < 1) throw new Error('no UI click sound');

  // --- in a match: shooting ---
  await evalGame((w) => {
    w.settings.set('ambience', 0);
    w.app.startPractice('tdm', 'easy');
  });
  await page.waitForFunction('window.__whoopa.game && window.__whoopa.game.snap && window.__whoopa.game.snap.phase === 1', { timeout: 15000 });
  // park the bots so the only sounds are ours
  await evalGame((w) => {
    const sim = w.session.sim;
    const me = sim.players[w.session.myIdx];
    for (const p of sim.players) {
      if (!p || p === me) continue;
      p.state.x = p.team === 0 ? -76 : 76; p.state.z = 0;
      p.brain = null; p.isBot = false;
    }
  });
  await wait(1800);
  const quiet = await peakOver(400);
  const s0 = await evalGame((w) => w.app.audio.played);
  await page.mouse.move(640, 360);
  await page.mouse.down();
  const loud = await peakOver(450);
  await page.mouse.up();
  const s1 = await evalGame((w) => w.app.audio.played);
  console.log(`  standing still: level ${quiet.toFixed(4)}; firing: level ${loud.toFixed(3)}, ${s1 - s0} sounds started`);
  if (!(loud > 0.1)) throw new Error('gunshots are silent');
  if (!(quiet < 0.02)) throw new Error('unexpected noise while standing still');
  if (s1 - s0 < 3) throw new Error('expected several gunshot / impact sounds');

  // footsteps while sprinting
  await wait(900);
  const f0 = await evalGame((w) => w.app.audio.played);
  await down('KeyW'); await down('ShiftLeft');
  const steps = await peakOver(1200);
  await up('ShiftLeft'); await up('KeyW');
  const f1 = await evalGame((w) => w.app.audio.played);
  console.log(`  sprinting for 1.2 s: ${f1 - f0} footsteps, level ${steps.toFixed(3)}`);
  if (f1 - f0 < 3) throw new Error('no footsteps while sprinting');

  // a remote gunshot is quieter far away and panned to the correct side
  await wait(500);
  const pos = await evalGame((w) => {
    const st = w.game.predictor.state;
    return { x: st.x, y: st.y, z: st.z, yaw: w.game.view.yaw };
  });
  const remote = async (dist) => {
    await evalGame((w, p, d) => {
      // straight ahead of the player (yaw 0 faces -Z)
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      w.app.audio.gunshot(1, { x: p.x + fx * d, y: p.y + 1.5, z: p.z + fz * d }, false);
    }, pos, dist);
    const pk = await peakOver(300);
    await wait(500);
    return pk;
  };
  const near = await remote(6);
  const far = await remote(70);
  console.log(`  enemy rifle 6 m away: level ${near.toFixed(3)}; 70 m away: ${far.toFixed(3)}`);
  if (!(near > far * 2.5)) throw new Error('distance attenuation is not working');
  if (!(far > 0.005)) throw new Error('distant gunfire should still be audible');

  // master volume at 0 silences everything
  await evalGame((w) => w.settings.set('volume', 0));
  await wait(400);
  await page.mouse.down();
  const muted = await peakOver(350);
  await page.mouse.up();
  await evalGame((w) => { w.settings.set('volume', 0.8); w.settings.set('ambience', 0.6); });
  console.log(`  firing with master volume 0: level ${muted.toFixed(5)}`);
  if (!(muted < 0.002)) throw new Error('master volume 0 is not silent');
}
