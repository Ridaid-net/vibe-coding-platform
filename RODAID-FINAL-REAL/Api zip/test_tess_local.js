const {createWorker}=require('tesseract.js')
const sharp=require('sharp')
async function test(){
  try {
    const svg=`<svg width="300" height="80" xmlns="http://www.w3.org/2000/svg"><rect width="300" height="80" fill="white"/><text x="150" y="55" font-family="Courier New" font-size="30" fill="black" text-anchor="middle">SN-R84MK</text></svg>`
    const buf=await sharp(Buffer.from(svg)).png().toBuffer()
    const w=await createWorker('eng',1,{logger:()=>{}})
    const r=await w.recognize(buf)
    console.log('Texto:', JSON.stringify(r.data.text.trim()))
    console.log('Confianza:', r.data.confidence.toFixed(0))
    await w.terminate()
  } catch(e) {
    console.error('ERR:', e.message?.slice(0,150))
  }
}
test().then(()=>process.exit(0)).catch(e=>{console.error(e.message?.slice(0,100));process.exit(0)})
