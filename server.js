require('dotenv').config();
const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const app = express();
app.use(express.json());
const db = mysql.createPool({ host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || 'kiot1234', database: process.env.DB_NAME || 'nova_bank', waitForConnections: true, connectionLimit: 10 });
const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const accountNumber = () => `NV${Date.now().toString().slice(-9)}`;
const money = n => Number(n || 0);
const clientError = message => Object.assign(new Error(message), {status:400});
const hashPin = pin => crypto.scryptSync(String(pin), 'nova-bank-client-auth', 64).toString('hex');
const sessions = new Map();
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(part => { const i=part.indexOf('='); return [part.slice(0,i).trim(), decodeURIComponent(part.slice(i+1))]; }));
const clientSession = req => { const token=cookies(req).nova_client; const session=token && sessions.get(token); if(!session || session.expires < Date.now()) { if(token) sessions.delete(token); return null; } return session; };
const requireClient = (req,res,next) => { const session=clientSession(req); if(!session) return res.status(401).json({message:'Please sign in to continue.'}); req.clientId=session.customerId; next(); };
const newClientSession = (res, customerId) => { const token=crypto.randomBytes(32).toString('hex'); sessions.set(token,{customerId,expires:Date.now()+8*60*60*1000}); res.setHeader('Set-Cookie', `nova_client=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`); };
const adminSession = req => { const token=cookies(req).nova_admin; const session=token && sessions.get(token); if(!session || session.expires < Date.now() || session.role!=='admin') { if(token) sessions.delete(token); return null; } return session; };
const requireAdmin = (req,res,next) => { if(!adminSession(req)) return res.status(401).json({message:'Administrator sign-in is required.'}); next(); };
const newAdminSession = res => { const token=crypto.randomBytes(32).toString('hex'); sessions.set(token,{role:'admin',expires:Date.now()+8*60*60*1000}); res.setHeader('Set-Cookie', `nova_admin=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`); };

async function ensureClientAuthColumns(){
  const [columns] = await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customers' AND COLUMN_NAME IN ('client_id','password_hash')");
  const known=new Set(columns.map(c=>c.COLUMN_NAME));
  if(!known.has('client_id')) await db.query('ALTER TABLE customers ADD COLUMN client_id VARCHAR(30) NULL UNIQUE AFTER id');
  if(!known.has('password_hash')) await db.query('ALTER TABLE customers ADD COLUMN password_hash CHAR(128) NULL');
  await db.query("UPDATE customers SET client_id=CONCAT('NVCLIENT',LPAD(id,4,'0')) WHERE client_id IS NULL");
  await db.query('UPDATE customers SET password_hash=? WHERE password_hash IS NULL',[hashPin('1234')]);
}

app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','login.html')));
app.get('/admin',(req,res)=>res.sendFile(path.join(__dirname,'public','admin-login.html')));

app.post('/api/admin/login',(req,res)=>{
  const {admin_id,pin}=req.body;
  const expectedId=process.env.ADMIN_ID || 'admin', expectedPin=process.env.ADMIN_PIN || '1234';
  const valid=String(admin_id||'').trim()===expectedId && String(pin||'')===expectedPin;
  if(!valid) return res.status(401).json({message:'Invalid administrator ID or PIN.'});
  newAdminSession(res); res.json({message:'Administrator signed in.'});
});
app.post('/api/admin/logout',(req,res)=>{const token=cookies(req).nova_admin;if(token)sessions.delete(token);res.setHeader('Set-Cookie','nova_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');res.json({message:'Signed out.'})});

app.post('/api/client/login', asyncRoute(async(req,res)=>{
  const {client_id,pin}=req.body;
  if(!client_id || !pin) return res.status(400).json({message:'Enter your client ID and PIN.'});
  const [[client]]=await db.query('SELECT id,full_name,client_id,password_hash FROM customers WHERE client_id=?',[String(client_id).trim().toUpperCase()]);
  const supplied=hashPin(pin);
  if(!client || !crypto.timingSafeEqual(Buffer.from(client.password_hash || supplied),Buffer.from(supplied))) return res.status(401).json({message:'Invalid client ID or PIN.'});
  newClientSession(res,client.id);
  res.json({message:'Signed in successfully.',client:{name:client.full_name,clientId:client.client_id}});
}));
app.post('/api/client/logout',(req,res)=>{const token=cookies(req).nova_client;if(token)sessions.delete(token);res.setHeader('Set-Cookie','nova_client=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');res.json({message:'Signed out.'})});
app.get('/api/client/me',requireClient,asyncRoute(async(req,res)=>{
  const [[customer]]=await db.query('SELECT full_name,email,phone,client_id FROM customers WHERE id=?',[req.clientId]);
  const [accounts]=await db.query('SELECT id,account_number,account_type,balance,status,opened_at FROM accounts WHERE customer_id=? ORDER BY opened_at',[req.clientId]);
  const [loans]=await db.query('SELECT id,loan_type,principal,interest_rate,tenure_months,emi,outstanding_balance,status,application_date,purpose FROM loans WHERE customer_id=? ORDER BY application_date DESC',[req.clientId]);
  const [transactions]=await db.query('SELECT t.*,a.account_number FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE a.customer_id=? ORDER BY t.created_at DESC LIMIT 20',[req.clientId]);
  res.json({customer,accounts,loans,transactions});
}));
app.post('/api/client/transactions/transfer',requireClient,asyncRoute(async(req,res)=>{
  const {from_account_id,recipient_account_number,amount,description}=req.body, value=money(amount);
  if(!from_account_id || !recipient_account_number || value<=0) return res.status(400).json({message:'Choose accounts and enter a valid amount.'});
  const conn=await db.getConnection();
  try { await conn.beginTransaction(); const [[source]]=await conn.query('SELECT id,account_number,balance,status FROM accounts WHERE id=? AND customer_id=? FOR UPDATE',[from_account_id,req.clientId]); const [[recipient]]=await conn.query('SELECT id,account_number,status FROM accounts WHERE account_number=? FOR UPDATE',[String(recipient_account_number).trim().toUpperCase()]);
    if(!source || source.status!=='Active') throw clientError('Your selected account is unavailable.'); if(!recipient || recipient.status!=='Active') throw clientError('Recipient account was not found or is unavailable.'); if(source.id===recipient.id) throw clientError('Choose a different recipient account.'); if(money(source.balance)<value) throw clientError('Insufficient account balance.');
    await conn.query('UPDATE accounts SET balance=balance-? WHERE id=?',[value,source.id]); await conn.query('UPDATE accounts SET balance=balance+? WHERE id=?',[value,recipient.id]);
    const note=description || `Transfer to ${recipient.account_number}`; await conn.query("INSERT INTO transactions(account_id,transaction_type,amount,description) VALUES(?,'Transfer',?,?)",[source.id,value,note]); await conn.query("INSERT INTO transactions(account_id,transaction_type,amount,description) VALUES(?,'Transfer',?,?)",[recipient.id,value,`Transfer from ${source.account_number}`]); await conn.commit(); res.status(201).json({message:'Transfer completed.'});
  } catch(e){await conn.rollback();throw e;} finally {conn.release();}
}));
app.post('/api/client/loans',requireClient,asyncRoute(async(req,res)=>{
  const {loan_type,principal,interest_rate,tenure_months,purpose}=req.body, P=money(principal),rate=money(interest_rate)/1200,n=Number(tenure_months);
  if(!['Personal','Home','Auto','Education','Business'].includes(loan_type)||!P||!rate||!n) return res.status(400).json({message:'Complete all loan fields with valid values.'});
  const emi=P*rate*Math.pow(1+rate,n)/(Math.pow(1+rate,n)-1); await db.query('INSERT INTO loans(customer_id,loan_type,principal,interest_rate,tenure_months,emi,outstanding_balance,status,application_date,purpose) VALUES(?,?,?,?,?,?,?,"Pending",CURDATE(),?)',[req.clientId,loan_type,P,money(interest_rate),n,emi,P,purpose||null]); res.status(201).json({message:`Loan application submitted. Estimated EMI: ₹${emi.toFixed(2)}`});
}));
app.post('/api/client/loans/:id/payments',requireClient,asyncRoute(async(req,res)=>{
  const {account_id,amount,notes}=req.body,value=money(amount); if(!account_id||value<=0)return res.status(400).json({message:'Choose a payment account and enter a valid amount.'}); const conn=await db.getConnection();
  try{await conn.beginTransaction();const [[loan]]=await conn.query('SELECT outstanding_balance,status FROM loans WHERE id=? AND customer_id=? FOR UPDATE',[req.params.id,req.clientId]);const [[account]]=await conn.query('SELECT account_number,balance,status FROM accounts WHERE id=? AND customer_id=? FOR UPDATE',[account_id,req.clientId]);if(!loan||loan.status!=='Approved')throw clientError('Only your approved loans can receive payments.');if(!account||account.status!=='Active')throw clientError('Payment account is unavailable.');const paid=Math.min(value,money(loan.outstanding_balance));if(money(account.balance)<paid)throw clientError('Insufficient account balance.');await conn.query('UPDATE accounts SET balance=balance-? WHERE id=?',[paid,account_id]);await conn.query("INSERT INTO transactions(account_id,transaction_type,amount,description) VALUES(?,'Withdrawal',?,?)",[account_id,paid,`Loan payment: ${notes||'EMI payment'}`]);await conn.query('INSERT INTO loan_payments(loan_id,amount,payment_date,notes) VALUES(?,?,CURDATE(),?)',[req.params.id,paid,notes||'EMI payment']);await conn.query('UPDATE loans SET outstanding_balance=GREATEST(0,outstanding_balance-?), status=IF(outstanding_balance-?<=0,"Closed",status) WHERE id=?',[paid,paid,req.params.id]);await conn.commit();res.json({message:'Loan payment completed.'});}catch(e){await conn.rollback();throw e;}finally{conn.release();}
}));

app.use(['/api/dashboard','/api/customers','/api/accounts','/api/transactions','/api/loans'],requireAdmin);

app.get('/api/dashboard', asyncRoute(async (req,res) => {
  const [[customers]] = await db.query('SELECT COUNT(*) total FROM customers');
  const [[accounts]] = await db.query("SELECT COUNT(*) total, COALESCE(SUM(balance),0) deposits FROM accounts WHERE status='Active'");
  const [[loans]] = await db.query("SELECT COUNT(*) total, COALESCE(SUM(outstanding_balance),0) outstanding FROM loans WHERE status='Approved'");
  const [recent] = await db.query(`SELECT t.*, a.account_number, c.full_name FROM transactions t JOIN accounts a ON a.id=t.account_id JOIN customers c ON c.id=a.customer_id ORDER BY t.created_at DESC LIMIT 6`);
  res.json({customers: customers.total, accounts: accounts.total, deposits: accounts.deposits, loans: loans.total, outstanding: loans.outstanding, recent});
}));
app.get('/api/customers', asyncRoute(async (req,res) => { const [rows] = await db.query('SELECT c.*, COUNT(a.id) accounts FROM customers c LEFT JOIN accounts a ON a.customer_id=c.id GROUP BY c.id ORDER BY c.created_at DESC'); res.json(rows); }));
app.post('/api/customers', asyncRoute(async (req,res) => { const {full_name,email,phone,address,account_type='Savings',opening_balance=0,client_pin='1234'}=req.body; if(!full_name||!email||!phone) return res.status(400).json({message:'Name, email and phone are required.'}); if(!/^\d{4,12}$/.test(String(client_pin))) return res.status(400).json({message:'Client PIN must contain 4–12 digits.'}); const conn=await db.getConnection(); try { await conn.beginTransaction(); const [result]=await conn.query('INSERT INTO customers(full_name,email,phone,address,password_hash) VALUES(?,?,?,?,?)',[full_name,email,phone,address,hashPin(client_pin)]); const clientId=`NVCLIENT${String(result.insertId).padStart(4,'0')}`; await conn.query('UPDATE customers SET client_id=? WHERE id=?',[clientId,result.insertId]); const [acc]=await conn.query('INSERT INTO accounts(customer_id,account_number,account_type,balance) VALUES(?,?,?,?)',[result.insertId,accountNumber(),account_type,money(opening_balance)]); if(money(opening_balance)>0) await conn.query("INSERT INTO transactions(account_id,transaction_type,amount,description) VALUES(?,'Deposit',?,'Opening balance')",[acc.insertId,money(opening_balance)]); await conn.commit(); res.status(201).json({message:`Customer and account created. Client ID: ${clientId}`}); } catch(e){await conn.rollback(); throw e;} finally {conn.release();} }));
app.get('/api/accounts', asyncRoute(async(req,res)=>{const [rows]=await db.query('SELECT a.*,c.full_name,c.email FROM accounts a JOIN customers c ON c.id=a.customer_id ORDER BY a.opened_at DESC');res.json(rows)}));
app.post('/api/transactions', asyncRoute(async(req,res)=>{const {account_id,transaction_type,amount,description}=req.body; const value=money(amount); if(!account_id||!value||value<=0) return res.status(400).json({message:'Choose an account and enter a valid amount.'}); const conn=await db.getConnection(); try{await conn.beginTransaction(); const [[a]]=await conn.query('SELECT balance,status FROM accounts WHERE id=? FOR UPDATE',[account_id]); if(!a||a.status!=='Active') throw new Error('This account is unavailable.'); if(transaction_type==='Withdrawal'&&money(a.balance)<value) return res.status(400).json({message:'Insufficient account balance.'}); const delta=transaction_type==='Withdrawal'?-value:value; await conn.query('UPDATE accounts SET balance=balance+? WHERE id=?',[delta,account_id]); await conn.query('INSERT INTO transactions(account_id,transaction_type,amount,description) VALUES(?,?,?,?)',[account_id,transaction_type,value,description||null]); await conn.commit();res.status(201).json({message:'Transaction recorded.'});}catch(e){await conn.rollback();throw e;}finally{conn.release();}}));
app.get('/api/loans', asyncRoute(async(req,res)=>{const [rows]=await db.query('SELECT l.*,c.full_name,c.email FROM loans l JOIN customers c ON c.id=l.customer_id ORDER BY FIELD(l.status,"Pending","Approved","Rejected","Closed"),l.application_date DESC');res.json(rows)}));
app.post('/api/loans', asyncRoute(async(req,res)=>{const {customer_id,loan_type,principal,interest_rate,tenure_months,purpose,credit_score}=req.body; const P=money(principal), rate=money(interest_rate)/1200, n=Number(tenure_months); if(!customer_id||!P||!rate||!n) return res.status(400).json({message:'Complete all loan fields.'}); const emi=P*rate*Math.pow(1+rate,n)/(Math.pow(1+rate,n)-1); await db.query('INSERT INTO loans(customer_id,loan_type,principal,interest_rate,tenure_months,emi,outstanding_balance,status,application_date,purpose,credit_score) VALUES(?,?,?,?,?,?,?,"Pending",CURDATE(),?,?,?)',[customer_id,loan_type,P,money(interest_rate),n,emi,P,purpose||null,credit_score||null]);res.status(201).json({message:`Loan application submitted. Estimated EMI: ₹${emi.toFixed(2)}`});}));
app.patch('/api/loans/:id/status',asyncRoute(async(req,res)=>{const {status}=req.body;if(!['Approved','Rejected','Closed'].includes(status))return res.status(400).json({message:'Invalid status.'});await db.query('UPDATE loans SET status=?, approval_date=IF(?="Approved",CURDATE(),approval_date) WHERE id=?',[status,status,req.params.id]);res.json({message:`Loan ${status.toLowerCase()}.`})}));
app.post('/api/loans/:id/payments',asyncRoute(async(req,res)=>{const amount=money(req.body.amount);if(!amount||amount<=0)return res.status(400).json({message:'Enter a valid payment amount.'});const conn=await db.getConnection();try{await conn.beginTransaction();const [[loan]]=await conn.query('SELECT outstanding_balance,status FROM loans WHERE id=? FOR UPDATE',[req.params.id]);if(!loan||loan.status!=='Approved')throw new Error('Only approved loans can receive payments.');const paid=Math.min(amount,money(loan.outstanding_balance));await conn.query('INSERT INTO loan_payments(loan_id,amount,payment_date,notes) VALUES(?,?,CURDATE(),?)',[req.params.id,paid,req.body.notes||'EMI payment']);await conn.query('UPDATE loans SET outstanding_balance=GREATEST(0,outstanding_balance-?), status=IF(outstanding_balance-?<=0,"Closed",status) WHERE id=?',[paid,paid,req.params.id]);await conn.commit();res.json({message:'Loan payment posted.'});}catch(e){await conn.rollback();throw e;}finally{conn.release();}}));
app.get('/index.html',(req,res)=>{if(!adminSession(req))return res.redirect('/admin');res.sendFile(path.join(__dirname,'public','index.html'))});
app.use(express.static(path.join(__dirname, 'public'),{index:false}));
app.use((err,req,res,next)=>{console.error(err);res.status(err.status||500).json({message:err.code==='ER_DUP_ENTRY'?'That email already exists.':err.message||'Something went wrong.'})});
ensureClientAuthColumns().then(()=>app.listen(process.env.PORT||1234,()=>console.log(`Nova Bank running at http://localhost:${process.env.PORT||1234}`))).catch(err=>{console.error('Unable to prepare client authentication:',err);process.exit(1)});
