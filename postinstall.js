const { exec } = require('child_process');

const script = process.platform === 'win32' ? 'postinstall.bat' : 'sh postinstall.sh';

exec(script, (err, stdout, stderr) => {
  if (err) {
    console.error(`Error: ${stderr}`);
    process.exit(1);
  } else {
    console.log(stdout);
  }
});
