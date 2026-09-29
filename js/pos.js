/* =========================================================
 * pos.js — 獨立 POS 收銀介面（#pos）
 * 不使用商家後台外框，適合實體店面平板／電腦長時間開啟。
 * ========================================================= */
(function(){
  const {esc,money,toast,confirmBox,Router}=window.UI,root=()=>document.getElementById('app');
  let cart=[],locationId='',customerId='',lastOrder=null;
  const rows=()=>DB.products.list().filter(p=>DB.products.isLive(p)).flatMap(p=>p.variants.map(v=>({productId:p.id,variantId:v.id,name:p.name,optionText:Object.values(v.options||{}).join(' / '),sku:v.sku||'',price:v.price,stock:v.stock,image:DB.products.cover(p),color:p.color})));
  const subtotal=()=>cart.reduce((n,x)=>n+x.price*x.qty,0);
  const currentEmail=()=>String((DB.admin.user()||{}).email||'').toLowerCase();

  function noPerm(){root().innerHTML=`<div class="pos-gate"><div class="gate-card"><h1>沒有 POS 權限</h1><p class="muted">請找店主到「員工」替這個帳號開啟「POS 收銀」權限。</p><a class="btn" href="#admin">回商家後台</a></div></div>`;}

  async function render(){
    if(!DB.features.pos||!DB.admin.can('pos'))return noPerm();
    const locs=DB.pos.locations().filter(x=>x.enabled);
    if(!locs.length){root().innerHTML=`<div class="pos-gate"><div class="gate-card"><h1>尚未建立門市</h1><p class="muted">請店主先到商家後台建立門市。</p><a class="btn btn-primary" href="#admin/locations">前往門市管理</a></div></div>`;return;}
    if(!locs.some(x=>x.id===locationId))locationId=(locs.find(x=>x.isDefault)||locs[0]).id;
    let shifts=[];try{shifts=await DB.pos.shifts(100);}catch(e){toast(e.message,'error');}
    const mail=currentEmail(),shift=shifts.find(x=>x.status==='open'&&x.locationId===locationId&&(!mail||String(x.cashier||'').toLowerCase()===mail))||(DB.mode==='local'&&shifts.find(x=>x.status==='open'&&x.locationId===locationId));
    root().innerHTML=`<div class="pos-app">
      <header class="pos-head"><div><b>${esc(DB.settings.get().name)}</b><span>POS 收銀台</span></div><div class="pos-head-actions"><select id="p-location" aria-label="銷售門市">${locs.map(l=>`<option value="${l.id}" ${l.id===locationId?'selected':''}>${esc(l.name)}</option>`).join('')}</select><span class="pill ${shift?'ok':'warn'}">${shift?'已開班':'尚未開班'}</span><a class="btn btn-sm" href="#admin">商家後台</a></div></header>
      ${lastOrder?`<div class="pos-success"><b>結帳完成</b><span>${esc(lastOrder.number)}・${money(lastOrder.total)}</span><button class="btn btn-sm" id="p-success-close">關閉</button></div>`:''}
      ${shift?'':`<section class="pos-open"><div><h1>開始今天的收銀</h1><p>請輸入收銀櫃原本的備用金。</p></div><input id="p-opening" type="number" min="0" value="0" aria-label="開班備用金"><button class="btn btn-primary" id="p-open">開班</button></section>`}
      <main class="pos-work ${shift?'':'is-locked'}">
        <section class="pos-catalog"><div class="pos-searchbar"><input id="p-search" type="search" placeholder="搜尋商品名稱、規格或 SKU" autofocus><button class="btn btn-primary" id="p-custom" type="button">＋ 自訂品項</button></div><div class="pos-grid" id="p-products"></div></section>
        <aside class="pos-bill"><div class="pos-bill-head"><div><b>本次結帳</b><small id="p-lines">0 個品項</small></div><button class="btn btn-sm" id="p-clear">清空</button></div><div class="pos-bill-items" id="p-cart"></div>
          <div class="pos-bill-form"><div class="field"><label for="p-customer-q">會員（選填）</label><div class="pos-inline"><input id="p-customer-q" placeholder="姓名／手機／Email"><button class="btn btn-sm" id="p-find">搜尋</button></div><select id="p-customer" hidden><option value="">現場散客</option></select><span class="hint" id="p-customer-hint">未選擇會員</span></div>
          <div class="pos-two"><div class="field"><label for="p-discount">整單折扣</label><input id="p-discount" type="number" min="0" value="0"></div><div class="field"><label for="p-pay">付款方式</label><select id="p-pay"><option value="cash">現金</option><option value="card">信用卡（外部刷卡機）</option><option value="mobile">行動支付</option><option value="other">其他</option></select></div></div>
          <div class="pos-cash" id="p-cash-box"><div class="field"><label for="p-received">實收現金</label><input id="p-received" type="number" min="0" value="0"></div><div><span>找零</span><strong id="p-change">NT$0</strong></div></div>
          <div class="pos-grand"><span>應收</span><strong id="p-total">NT$0</strong></div><button class="pos-submit" id="p-submit" ${shift?'':'disabled'}>完成結帳</button></div>
        </aside>
      </main><div id="p-dialog"></div></div>`;
    bind(shift,rows());
  }

  function bind(shift,products){
    const productBox=document.getElementById('p-products'),cartBox=document.getElementById('p-cart');
    const drawProducts=()=>{const q=document.getElementById('p-search').value.trim().toLowerCase(),list=products.filter(x=>!q||[x.name,x.optionText,x.sku].some(v=>String(v).toLowerCase().includes(q)));productBox.innerHTML=list.length?list.map(x=>`<button class="pos-tile" data-add="${x.variantId}" ${x.stock<=0?'disabled':''}>${x.image?`<img src="${esc(x.image)}" alt="">`:`<i style="background:${esc(x.color)}">${esc(x.name.slice(0,1))}</i>`}<span><b>${esc(x.name)}</b><small>${esc(x.optionText||'單一規格')}</small><em>庫存 ${x.stock}</em><strong>${money(x.price)}</strong></span></button>`).join(''):`<div class="empty">找不到商品</div>`;productBox.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{const r=products.find(x=>x.variantId===b.dataset.add),hit=cart.find(x=>x.variantId===r.variantId);if(hit){if(hit.qty>=r.stock)return toast('庫存不足','error');hit.qty++;}else cart.push({...r,qty:1});drawCart();});};
    const due=()=>Math.max(0,subtotal()-(+document.getElementById('p-discount').value||0));
    const drawMoney=()=>{const total=due(),received=+document.getElementById('p-received').value||0;document.getElementById('p-total').textContent=money(total);document.getElementById('p-change').textContent=money(Math.max(0,received-total));document.getElementById('p-cash-box').hidden=document.getElementById('p-pay').value!=='cash';};
    const drawCart=()=>{document.getElementById('p-lines').textContent=`${cart.reduce((n,x)=>n+x.qty,0)} 件`;cartBox.innerHTML=cart.length?cart.map((x,i)=>`<div class="pos-line"><div><b>${esc(x.name)}</b><small>${esc(x.custom?'自訂品項':x.optionText||'單一規格')}</small></div><div class="pos-step"><button data-minus="${i}">−</button><input data-qty="${i}" type="number" min="1" max="${x.custom?999:x.stock}" value="${x.qty}"><button data-plus="${i}">＋</button></div><strong>${money(x.price*x.qty)}</strong><button class="pos-x" data-del="${i}" aria-label="移除">×</button></div>`).join(''):`<div class="pos-empty">點選左邊商品<br>加入本次結帳</div>`;cartBox.querySelectorAll('[data-minus]').forEach(b=>b.onclick=()=>{const x=cart[+b.dataset.minus];if(x.qty>1)x.qty--;else cart.splice(+b.dataset.minus,1);drawCart();});cartBox.querySelectorAll('[data-plus]').forEach(b=>b.onclick=()=>{const x=cart[+b.dataset.plus],max=x.custom?999:x.stock;if(x.qty<max)x.qty++;else toast('已達可售數量','error');drawCart();});cartBox.querySelectorAll('[data-qty]').forEach(e=>e.onchange=()=>{const x=cart[+e.dataset.qty],max=x.custom?999:x.stock;x.qty=Math.max(1,Math.min(max,Math.floor(+e.value||1)));drawCart();});cartBox.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{cart.splice(+b.dataset.del,1);drawCart();});drawMoney();};
    drawProducts();drawCart();
    document.getElementById('p-search').oninput=drawProducts;document.getElementById('p-discount').oninput=drawMoney;document.getElementById('p-received').oninput=drawMoney;document.getElementById('p-pay').onchange=drawMoney;document.getElementById('p-clear').onclick=()=>{cart=[];drawCart();};document.getElementById('p-location').onchange=e=>{locationId=e.target.value;cart=[];render();};
    const close=document.getElementById('p-success-close');if(close)close.onclick=()=>{lastOrder=null;render();};
    const open=document.getElementById('p-open');if(open)open.onclick=async()=>{try{await DB.pos.openShift(locationId,+document.getElementById('p-opening').value||0);toast('開班完成');render();}catch(e){toast(e.message,'error');}};
    document.getElementById('p-custom').onclick=()=>customDialog(drawCart);
    document.getElementById('p-find').onclick=async()=>{const q=document.getElementById('p-customer-q').value.trim();if(!q)return;try{const r=await DB.customers.query({q},{limit:30}),sel=document.getElementById('p-customer');sel.innerHTML='<option value="">現場散客</option>'+(r.rows||[]).map(c=>`<option value="${c.id}">${esc(c.name)}・${esc(c.phone)}</option>`).join('');sel.hidden=false;sel.onchange=()=>{customerId=sel.value;document.getElementById('p-customer-hint').textContent=sel.value?sel.options[sel.selectedIndex].text:'現場散客';};document.getElementById('p-customer-hint').textContent=r.rows.length?`找到 ${r.rows.length} 位會員`:'找不到會員';}catch(e){toast(e.message,'error');}};
    document.getElementById('p-submit').onclick=async e=>{if(!cart.length)return toast('請先加入品項','error');const total=due(),payment=document.getElementById('p-pay').value,received=+document.getElementById('p-received').value||0;if(total<0)return toast('折扣不能超過商品金額','error');if(payment==='cash'&&received<total)return toast('實收現金不足','error');if(!await confirmBox({title:`確認收款 ${money(total)}`,body:payment==='cash'?`實收 ${money(received)}，找零 ${money(received-total)}`:'完成後會建立 POS 訂單並扣除商品庫存。',ok:'完成結帳'}))return;e.target.disabled=true;try{lastOrder=await DB.pos.sale({locationId,shiftId:shift.id,items:cart,discount:+document.getElementById('p-discount').value||0,payment,customerId,note:''});cart=[];customerId='';await render();}catch(err){toast(err.message,'error');e.target.disabled=false;}};
  }

  function customDialog(redraw){const box=document.getElementById('p-dialog');box.innerHTML=`<div class="pos-modal"><form class="pos-modal-card" id="p-custom-form"><h2>新增自訂品項</h2><p class="muted">適合臨時服務、包裝費或尚未建立成商品的現場品項。這類品項不會扣商品庫存。</p><div class="field"><label for="pc-name">品項名稱</label><input id="pc-name" maxlength="60" required placeholder="例如：禮盒包裝"></div><div class="pos-two"><div class="field"><label for="pc-price">單價</label><input id="pc-price" type="number" min="0" max="10000000" required></div><div class="field"><label for="pc-qty">數量</label><input id="pc-qty" type="number" min="1" max="999" value="1" required></div></div><div class="actions"><button class="btn" type="button" id="pc-cancel">取消</button><button class="btn btn-primary" type="submit">加入結帳</button></div></form></div>`;document.getElementById('pc-name').focus();document.getElementById('pc-cancel').onclick=()=>box.innerHTML='';document.getElementById('p-custom-form').onsubmit=e=>{e.preventDefault();const name=document.getElementById('pc-name').value.trim(),price=Math.round(+document.getElementById('pc-price').value||0),qty=Math.floor(+document.getElementById('pc-qty').value||0);if(!name||qty<1||price<0)return toast('請填寫完整的品項、單價與數量','error');cart.push({custom:true,id:'custom_'+Date.now(),name,price,qty,stock:999});box.innerHTML='';redraw();};}

  window.PosApp=async function(){await render();window.scrollTo(0,0);};
})();
