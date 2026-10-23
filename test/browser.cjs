const {chromium}=require('playwright');
const assert=require('node:assert/strict');
async function main(){
 const browser=await chromium.launch({headless:true});
 const a=await browser.newContext({viewport:{width:1440,height:1050}}),b=await browser.newContext({viewport:{width:390,height:844}});
 const pa=await a.newPage(),pb=await b.newPage(),errors=[];
 for(const p of [pa,pb])p.on('pageerror',e=>errors.push(e.message));
 const url='http://127.0.0.1:8322/mandragora/';
 await pa.goto(url);await pa.getByText('같은 밭에서 함께 자라는 중',{exact:true}).waitFor();
 await pa.locator('#plantHero').click();await pa.locator('#seedText').fill('오늘의 너에게. 조금 늦어도 괜찮아. 네 속도로 자라고 있으니까.');
 await pa.locator('input[name="mood"][value="cheer"]').check();await pa.locator('#plantSubmit').click();await pa.locator('#plantDialog').waitFor({state:'hidden'});
 assert.equal(await pa.locator('.plot.mine').count(),1);const pid=await pa.locator('.plot.mine').getAttribute('data-plot');
 await pb.goto(url);await pb.locator('[data-plot]').first().waitFor();
 const before=await pb.evaluate(async()=>JSON.stringify(await(await fetch('./api/farm')).json()));assert.ok(!before.includes('네 속도로'));
 await pb.waitForFunction(id=>farm?.plots.some(p=>p.id===id&&!p.mine&&p.readyAt<=Date.now()),pid);
 await pb.locator('[data-plot="'+pid+'"]').click();await pb.locator('#harvestDialog').waitFor({state:'visible'});
 assert.equal(await pb.locator('#harvestMessage').isVisible(),false);
 await pb.locator('#harvestSubmit').click();await pb.locator('#harvestMessage').waitFor({state:'visible'});assert.ok((await pb.locator('#harvestMessage').textContent()).includes('네 속도로'));
 await pb.locator('#thanks').click();await pb.getByRole('button',{name:'♥ 따뜻한 마음을 전했어요',exact:true}).waitFor();
 await pb.screenshot({path:'/private/tmp/mandragora-harvest.png',fullPage:true});
 await pb.locator('#harvestDialog .close').click();await pb.locator('[data-page="basket"]').click();await pb.locator('[data-note]').waitFor();
 await pb.reload();await pb.locator('[data-note]').waitFor();assert.equal(await pb.locator('[data-note]').count(),1);
 assert.ok(await pb.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow');
 await pa.locator('[data-page="planted"]').click();await pa.locator('#refresh').evaluate(e=>e.click());await pa.getByText('♡ 마음 잘 받았대요',{exact:true}).waitFor();
 await pa.locator('[data-page="farm"]').click();await pa.screenshot({path:'/private/tmp/mandragora-desktop.png',fullPage:true});await pb.screenshot({path:'/private/tmp/mandragora-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS anonymous planting, hidden content, growth, harvest, thanks, separate archives, persistence, desktop/mobile');
 await browser.close();
}
main().catch(e=>{console.error(e);process.exit(1)});
