/**
 * A wave washing across the screen: in from the left with a foaming crest, covering everything for a moment, and out
 * to the right. Used between the run and the results, and from the menus into a run.
 */
export class WaveWipe {
  private el: HTMLElement;
  constructor() {
    const el = document.createElement('div');
    el.id = 'wave-wipe';
    // the body of the wave, a curling crest on its leading (right) edge and a foam fringe trailing on its left
    el.innerHTML = `
      <svg viewBox="0 0 1500 1000" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="ww-sea" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#0b4d86"/><stop offset="0.55" stop-color="#0f7fae"/><stop offset="0.9" stop-color="#2fd0c4"/><stop offset="1" stop-color="#7ff0e0"/>
          </linearGradient>
        </defs>
        <path fill="url(#ww-sea)" d="M60,0 C20,120 90,220 40,340 C0,450 80,560 30,680 C-10,800 70,900 40,1000 L1290,1000
          C1350,930 1300,860 1360,800 C1440,720 1380,640 1420,560 C1470,470 1400,400 1440,300 C1490,190 1380,140 1420,60 C1440,20 1400,0 1380,0 Z"/>
        <path fill="none" stroke="#f4fbff" stroke-width="22" stroke-linecap="round" opacity="0.95" d="M1290,1000
          C1350,930 1300,860 1360,800 C1440,720 1380,640 1420,560 C1470,470 1400,400 1440,300 C1490,190 1380,140 1420,60 C1440,20 1400,0 1380,0"/>
        <path fill="none" stroke="#f4fbff" stroke-width="10" stroke-dasharray="2 34" stroke-linecap="round" opacity="0.8" d="M1250,1000
          C1310,930 1260,860 1320,800 C1400,720 1340,640 1380,560 C1430,470 1360,400 1400,300 C1450,190 1340,140 1380,60"/>
        <path fill="none" stroke="#e8f8ff" stroke-width="14" stroke-dasharray="3 28" stroke-linecap="round" opacity="0.7" d="M60,0
          C20,120 90,220 40,340 C0,450 80,560 30,680 C-10,800 70,900 40,1000"/>
      </svg>`;
    document.body.appendChild(el);
    this.el = el;
  }

  /** wash across over `ms` (covered at about 45%); `onCovered` runs while the screen is hidden */
  wash(ms = 1300, onCovered?: () => void) {
    const el = this.el;
    el.style.setProperty('--d', `${ms}ms`);
    el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
    if (onCovered) setTimeout(onCovered, ms * 0.45);
  }
}
