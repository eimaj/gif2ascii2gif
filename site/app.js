// gif2ascii in the browser: everything runs client-side.

const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el;
};

const ui = {
  file: $('file'),
  demo: $('demo'),
  urlForm: $('url-form'),
  url: $('url'),
  message: $('message'),
  width: $('width'),
  threshold: $('threshold'),
  keepBg: $('keep-bg'),
  scale: $('scale'),
  transparent: $('transparent'),
  bgColor: $('bg-color'),
  stage: $('stage'),
  canvas: $('preview'),
  placeholder: $('placeholder'),
  info: $('info'),
  downloadGif: $('download-gif'),
  downloadPlayer: $('download-player'),
};

function syncOutputs() {
  $('width-out').value = ui.width.value;
  $('threshold-out').value = ui.threshold.value;
  $('scale-out').value = ui.scale.value;
  ui.bgColor.disabled = ui.transparent.checked;
  ui.threshold.disabled = ui.keepBg.checked;
}

for (const el of [ui.width, ui.threshold, ui.keepBg, ui.scale, ui.transparent, ui.bgColor]) {
  el.addEventListener('input', syncOutputs);
}
syncOutputs();
