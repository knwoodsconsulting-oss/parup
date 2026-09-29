const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json;charset=UTF-8'}});
const body=async r=>{try{return await r.json()}catch{return {}}};
const num=v=>Number.isFinite(Number(v))?Number(v):0;
async function all(db,sql,bind=[]){return (await db.prepare(sql).bind(...bind).all()).results||[]}
async function one(db,sql,bind=[]){return await db.prepare(sql).bind(...bind).first()}
function itemLabel(i){return [i.brand,i.expression,i.size].filter(Boolean).join(' ')}
export default { async fetch(request,env){
 const u=new URL(request.url), p=u.pathname, m=request.method;
 try{
  if(p==='/api/health') return json({ok:true,app:'ParUp',version:'1.0.0'});
  if(p==='/api/bootstrap'&&m==='GET'){
   const [inventory,mappings,settings,imports]=await Promise.all([
    all(env.DB,'SELECT * FROM inventory WHERE active=1 ORDER BY category,brand,expression,size'),
    all(env.DB,`SELECT m.*, i.brand,i.expression,i.size FROM mappings m LEFT JOIN inventory i ON i.id=m.inventory_id ORDER BY m.toast_item`),
    all(env.DB,'SELECT * FROM settings'), all(env.DB,'SELECT * FROM imports ORDER BY imported_at DESC LIMIT 12')]);
   return json({inventory,mappings,settings:Object.fromEntries(settings.map(x=>[x.key,JSON.parse(x.value)])),imports});
  }
  if(p==='/api/inventory'&&m==='POST'){
   const b=await body(request); const r=await env.DB.prepare(`INSERT INTO inventory(category,brand,expression,size,unit_cost,open_qty,sealed_qty,weekly_par,sold_as,distributor,item_type,large_format_eligible,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`).bind(b.category||'Other',b.brand||'New Item',b.expression||'',b.size||'',num(b.unit_cost),num(b.open_qty),num(b.sealed_qty),num(b.weekly_par),b.sold_as||'Counted Item',b.distributor||'Southern',b.item_type||'Liquor',b.large_format_eligible?1:0,b.notes||'').first(); return json(r,201);
  }
  const im=p.match(/^\/api\/inventory\/(\d+)$/); if(im&&m==='PUT'){
   const b=await body(request),id=+im[1]; await env.DB.prepare(`UPDATE inventory SET category=?,brand=?,expression=?,size=?,unit_cost=?,open_qty=?,sealed_qty=?,weekly_par=?,sold_as=?,distributor=?,item_type=?,large_format_eligible=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(b.category,b.brand,b.expression||'',b.size||'',num(b.unit_cost),num(b.open_qty),num(b.sealed_qty),num(b.weekly_par),b.sold_as,b.distributor||'Southern',b.item_type||'Liquor',b.large_format_eligible?1:0,b.notes||'',id).run(); return json({ok:true});
  }
  if(im&&m==='DELETE'){await env.DB.prepare('UPDATE inventory SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(+im[1]).run();return json({ok:true})}
  if(p==='/api/settings'&&m==='PUT'){const b=await body(request);for(const [k,v] of Object.entries(b))await env.DB.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(k,JSON.stringify(v)).run();return json({ok:true})}
  if(p==='/api/mappings'&&m==='POST'){const b=await body(request);await env.DB.prepare(`INSERT INTO mappings(toast_item,inventory_id,sale_type,usage_amount,usage_unit,status,updated_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(toast_item) DO UPDATE SET inventory_id=excluded.inventory_id,sale_type=excluded.sale_type,usage_amount=excluded.usage_amount,usage_unit=excluded.usage_unit,status=excluded.status,updated_at=CURRENT_TIMESTAMP`).bind(b.toast_item,b.inventory_id||null,b.sale_type||'Needs Review',num(b.usage_amount),b.usage_unit||'oz',b.status||'Mapped').run();return json({ok:true})}
  if(p==='/api/imports'&&m==='POST'){
   const b=await body(request), rows=Array.isArray(b.rows)?b.rows:[]; if(!rows.length)return json({error:'No sales rows found.'},400);
   const ins=await env.DB.prepare('INSERT INTO imports(file_name,week_label,row_count) VALUES(?,?,?) RETURNING id').bind(b.file_name||'Toast export',b.week_label||'',rows.length).first();
   const stmts=rows.slice(0,10000).map(r=>env.DB.prepare('INSERT INTO sales(import_id,toast_item,quantity,net_sales,raw_json) VALUES(?,?,?,?,?)').bind(ins.id,String(r.toast_item||'').trim(),num(r.quantity),num(r.net_sales),JSON.stringify(r.raw||{}))); for(let i=0;i<stmts.length;i+=75)await env.DB.batch(stmts.slice(i,i+75));
   const names=[...new Set(rows.map(r=>String(r.toast_item||'').trim()).filter(Boolean))]; for(const name of names){await env.DB.prepare(`INSERT OR IGNORE INTO mappings(toast_item,sale_type,status) VALUES(?,'Needs Review','Review')`).bind(name).run()}
   return json({ok:true,import_id:ins.id,rows:rows.length,unique_items:names.length},201);
  }
  if(p==='/api/report'&&m==='GET'){
   const imp=await one(env.DB,'SELECT * FROM imports ORDER BY imported_at DESC LIMIT 1'); if(!imp)return json({hasData:false});
   const inventory=await all(env.DB,'SELECT * FROM inventory WHERE active=1');
   const sales=await all(env.DB,`SELECT s.toast_item,SUM(s.quantity) quantity,SUM(s.net_sales) net_sales,m.inventory_id,m.sale_type,m.usage_amount,m.usage_unit,m.status FROM sales s LEFT JOIN mappings m ON m.toast_item=s.toast_item WHERE s.import_id=? GROUP BY s.toast_item,m.inventory_id,m.sale_type,m.usage_amount,m.usage_unit,m.status`,[imp.id]);
   const byId=Object.fromEntries(inventory.map(i=>[i.id,{...i,est_used:0,whole_sold:0,sales_qty:0}])); let full=0,review=0,totalActivity=0;
   for(const s of sales){totalActivity+=num(s.quantity); if(!s.inventory_id||s.status!=='Mapped'){review++;continue} const i=byId[s.inventory_id]; if(!i)continue; i.sales_qty+=num(s.quantity); if(s.sale_type==='Whole Bottle'){i.whole_sold+=num(s.quantity);i.est_used+=num(s.quantity);full+=num(s.quantity)} else if(['Pour','Double','Wine Glass'].includes(s.sale_type)){const oz=num(s.usage_amount)*num(s.quantity); const ml=parseFloat(i.size)||750; const bottleOz=ml*0.033814; i.est_used+=bottleOz?oz/bottleOz:0} else if(s.sale_type==='Counted Item'){i.est_used+=num(s.quantity)} }
   const items=Object.values(byId).map(i=>{const on=num(i.open_qty)+num(i.sealed_qty),need=Math.max(0,num(i.weekly_par)-on);return {...i,on_hand:on,need_order:need,label:itemLabel(i)}});
   const order=items.filter(i=>i.need_order>0), top=[...items].sort((a,b)=>b.est_used-a.est_used)[0];
   return json({hasData:true,import:imp,metrics:{salesActivity:totalActivity,fullBottles:full,needsOrdered:order.reduce((a,x)=>a+x.need_order,0),topMover:top?.label||'—',reviewItems:review,estimatedOrderCost:order.reduce((a,x)=>a+x.need_order*num(x.unit_cost),0)},items,order,largeFormat:items.filter(i=>i.large_format_eligible&&i.est_used>0).sort((a,b)=>b.est_used-a.est_used)});
  }
  if(p.startsWith('/api/'))return json({error:'Not found'},404);
  return env.ASSETS.fetch(request);
 }catch(e){return json({error:e.message||'Server error'},500)}
}};
