// read-aloud.js — tap-to-advance step narration via the Web Speech API.
//
// Reads the *current* instruction step and highlights it; the cook taps "Next"
// (or taps a step) to advance. Deliberately no onend auto-advance — chained
// autoplay reads ahead of the cook. Starts from a user gesture (iOS requires
// one) and resolves voices via onvoiceschanged. Absent entirely when
// speechSynthesis is unavailable; it is a convenience for hands-busy sighted
// cooks, never a substitute for the page's semantic accessibility.
(() => {
  const synth = window.speechSynthesis;
  const steps = [...document.querySelectorAll('ol.instructions > li')];
  if (!synth || steps.length === 0) return;

  let voice = null;
  const pickVoice = () => {
    const voices = synth.getVoices();
    voice = voices.find((v) => v.lang?.startsWith('en') && v.default)
      || voices.find((v) => v.lang?.startsWith('en'))
      || voices[0] || null;
  };
  pickVoice();
  synth.addEventListener('voiceschanged', pickVoice);

  let i = -1;

  const heading = document.querySelector('.section-instructions h2') || steps[0].parentElement;
  const bar = document.createElement('div');
  bar.className = 'read-aloud';
  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.textContent = '▶ Read aloud';
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'secondary';
  nextBtn.textContent = 'Next step';
  nextBtn.hidden = true;
  const stopBtn = document.createElement('button');
  stopBtn.type = 'button';
  stopBtn.className = 'secondary';
  stopBtn.textContent = 'Stop';
  stopBtn.hidden = true;
  bar.append(startBtn, nextBtn, stopBtn);
  heading.insertAdjacentElement('afterend', bar);

  const speak = (n) => {
    if (n < 0 || n >= steps.length) return stop();
    synth.cancel();
    steps.forEach((li) => li.removeAttribute('aria-current'));
    i = n;
    const li = steps[i];
    li.setAttribute('aria-current', 'step');
    li.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const u = new SpeechSynthesisUtterance(`Step ${i + 1}. ${li.textContent.trim()}`);
    if (voice) u.voice = voice;
    synth.speak(u);
    nextBtn.hidden = false;
    stopBtn.hidden = false;
    startBtn.hidden = true;
    nextBtn.textContent = i + 1 >= steps.length ? 'Finish' : 'Next step';
  };

  function stop() {
    synth.cancel();
    steps.forEach((li) => li.removeAttribute('aria-current'));
    i = -1;
    nextBtn.hidden = true;
    stopBtn.hidden = true;
    startBtn.hidden = false;
  }

  startBtn.addEventListener('click', () => speak(0)); // user gesture unlocks iOS speech
  nextBtn.addEventListener('click', () => speak(i + 1));
  stopBtn.addEventListener('click', stop);
  steps.forEach((li, n) => li.addEventListener('click', () => { if (i !== -1) speak(n); }));
  window.addEventListener('pagehide', stop);
})();
