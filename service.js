const Service = require('node-windows').Service;

const svc = new Service({
  name: 'HikvisionBridge',
  description: 'Hikvision Middleware For Odoo',
  script: 'C:\\hikvision_middleware\\hikvision-middleware\\index.js',
  wait: 2,
  grow: 0.5,
  maxRetries: 999
});

svc.on('install', () => {
  console.log('Service Installed');
  svc.start();
});

svc.on('alreadyinstalled', () => {
  console.log('Service Already Installed');
});

svc.on('start', () => {
  console.log('Service Started');
});

svc.on('error', (err) => {
  console.error('SERVICE ERROR:', err);
});

svc.install();