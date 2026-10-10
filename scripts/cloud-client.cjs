// Existing Firebase CLI OAuth session. Never log tokens or private response bodies.
'use strict';
const PROJECT='rugatha-trello',BUCKET=PROJECT+'.firebasestorage.app';
async function cloudClient(){
 const auth=require('firebase-tools/lib/auth'),account=auth.getProjectDefaultAccount(process.cwd());
 if(!account)throw Error('Firebase CLI login required');
 const token=account.tokens.expires_at>Date.now()+60000?account.tokens:await auth.getAccessToken(account.tokens.refresh_token,account.tokens.scopes);
 return async(url,{method='GET',body,binary=false}={})=>{
  const response=await fetch(url,{method,headers:{Authorization:'Bearer '+token.access_token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok)throw Error(`Cloud request ${method} HTTP ${response.status} (${new URL(url).hostname})`);
  if(binary)return Buffer.from(await response.arrayBuffer());
  if(response.status===204)return null;return response.json();
 };
}
module.exports={PROJECT,BUCKET,cloudClient};
