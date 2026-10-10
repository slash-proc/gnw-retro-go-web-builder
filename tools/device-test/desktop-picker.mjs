import {execFileSync} from 'node:child_process';

const command=(...args)=>execFileSync('xdotool',args.map(String));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function screenshotText(name) {
  const path=`${process.env.GNW_TEST_REPORT_DIR}/${name}.png`;
  execFileSync('import',['-window','root',path]);
  const output=execFileSync('tesseract',[path,'stdout','--psm','11','tsv'],{encoding:'utf8',stdio:['ignore','pipe','ignore']});
  return output.split('\n').slice(1).map(line=>line.split('\t')).filter(row=>row.length>=12&&row[11].trim());
}

/** Drive Chromium's GTK directory picker on the isolated Xvfb desktop. */
export async function selectDirectoryInDesktop(path,name='folder-picker') {
  if(process.env.GNW_TEST_DESKTOP!=='1')throw new Error('Native directory selection requires --virtual-desktop or --view-desktop');
  const deadline=Date.now()+20_000;
  let picker='';
  while(Date.now()<deadline){
    try{picker=command('search','--onlyvisible','--name','^Select where this site can save changes$').toString().trim();}catch{}
    if(picker)break;
    await delay(200);
  }
  if(!picker)throw new Error('Chromium folder picker did not open');
  command('key','ctrl+l');
  command('type','--clearmodifiers','--',path);
  await delay(700);
  const [width]=command('getdisplaygeometry').toString().trim().split(/\s+/).map(Number);
  command('mousemove',Math.floor(width/2),86,'click',1);
  await delay(200);

  const openDeadline=Date.now()+15_000;
  let opened=false;
  while(Date.now()<openDeadline){
    const words=await screenshotText(`${name}-open`).catch(()=>[]);
    const button=words.find(row=>/^open$/i.test(row[11].trim()));
    if(button){
      command('mousemove',Number(button[6])+Number(button[8])/2,Number(button[7])+Number(button[9])/2,'click',1);
      opened=true;break;
    }
    await delay(300);
  }
  if(!opened)throw new Error(`GTK picker did not offer Open for ${path}`);

  // A newly picked directory may request one-session read/write access. The run-local
  // backup folder is disposable, so grant this operation for this visit only.
  const permissionDeadline=Date.now()+2_000;
  while(Date.now()<permissionDeadline){
    const words=await screenshotText(`${name}-permission`).catch(()=>[]);
    const allow=words.find(row=>/^allow$/i.test(row[11].trim())&&
      words.some(other=>/^this$/i.test(other[11].trim())&&Math.abs(Number(other[7])-Number(row[7]))<16)&&
      words.some(other=>/^time$/i.test(other[11].trim())&&Math.abs(Number(other[7])-Number(row[7]))<16));
    if(allow){
      command('mousemove',Number(allow[6])+Number(allow[8])/2,Number(allow[7])+Number(allow[9])/2,'click',1);
      break;
    }
    await delay(300);
  }
  await delay(250);
}
