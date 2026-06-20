// hammer.mjs
const { task } = require('@sinclair/hammer');

task('build', async () => {
  console.log('Construyendo proyecto...');
  });

task('clean', async () => {
  console.log('Limpiando...');
});

task('test', async () => {
  console.log('Ejecutando tests...');
});

