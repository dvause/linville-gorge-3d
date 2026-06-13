// On-screen controls for touch devices. A left-thumb joystick maps to the
// horizontal WASD plane (up = forward, sideways = strafe) and two hold buttons
// map to Q/E (down/up). Values feed controls.virtual as analog -1..1 axes, so
// partial joystick deflection gives proportionally slower flight. The DOM and
// its visibility (pointer: coarse) live in index.html.

const KNOB_TRAVEL = 46; // max knob offset from center, px

export function buildTouchControls(virtual) {
  const stick = document.getElementById('joystick');
  const knob = document.getElementById('joyknob');
  if (!stick || !knob) return;

  let activeId = null;

  function setFromEvent(e) {
    const r = stick.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > KNOB_TRAVEL) { dx *= KNOB_TRAVEL / len; dy *= KNOB_TRAVEL / len; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    virtual.strafe = dx / KNOB_TRAVEL;
    virtual.forward = -dy / KNOB_TRAVEL; // screen-up is forward
  }

  function release() {
    knob.style.transform = 'translate(0, 0)';
    virtual.strafe = 0;
    virtual.forward = 0;
    activeId = null;
  }

  stick.addEventListener('pointerdown', (e) => {
    activeId = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    setFromEvent(e);
    e.preventDefault();
  });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === activeId) setFromEvent(e); });
  stick.addEventListener('pointerup', (e) => { if (e.pointerId === activeId) release(); });
  stick.addEventListener('pointercancel', (e) => { if (e.pointerId === activeId) release(); });

  // press-and-hold vertical buttons
  function holdButton(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    const press = (e) => { virtual.vertical = value; e.preventDefault(); };
    const lift = () => { virtual.vertical = 0; };
    el.addEventListener('pointerdown', press);
    el.addEventListener('pointerup', lift);
    el.addEventListener('pointercancel', lift);
    el.addEventListener('pointerleave', lift);
  }
  holdButton('btn-up', 1);
  holdButton('btn-down', -1);
}
