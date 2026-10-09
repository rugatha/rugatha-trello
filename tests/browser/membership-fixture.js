export const fixture={members:[{id:'owner',name:'測試 Owner',emails:['owner@example.com'],role:'owner',status:'active',accessboard:['board']},{id:'viewer',name:'測試 Viewer',emails:['viewer@example.com'],role:'viewer',status:'active',accessboard:[]}],requests:[],fail:false,delay:false};
export async function listMembershipDirectory(){
 if(fixture.delay){fixture.delay=false;await new Promise(resolve=>fixture.resolve=resolve);}
 return structuredClone({members:fixture.members,boards:[{id:'board',name:'測試看板'}]});
}
export async function saveManagedMembership(data){
 fixture.requests.push(structuredClone(data));if(fixture.fail){fixture.fail=false;throw Error('離線，請重試');}
 if(data.memberId){Object.assign(fixture.members.find(m=>m.id===data.memberId),{role:data.role,status:data.status,accessboard:data.accessboard});}
 else fixture.members.push({id:data.requestId,name:data.name,emails:[data.email],role:data.role,status:data.status,accessboard:data.accessboard});
 return {memberId:data.memberId || data.requestId};
}

const initial=structuredClone(fixture.members);
fixture.reset=()=>{fixture.members=structuredClone(initial);fixture.requests=[];fixture.fail=false;fixture.delay=false;};
