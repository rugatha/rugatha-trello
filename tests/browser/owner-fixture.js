// Memory-only lifecycle behavior for the real UI; no cloud calls.
export * from './phase5-fixture.js';
import {fixture,loadWorkspace as baseLoad} from './phase5-fixture.js';
fixture.lifecycleCalls=[];fixture.boardArchived=false;fixture.boardDeleted=false;
fixture.archivedCards=[{id:'old',title:'封存測試牌卡',columnId:'col'}];
export async function loadWorkspace(account){
 const state=await baseLoad(account);
 if(fixture.boardDeleted)state.boards=[];
 else for(const board of state.boards){board.archived=fixture.boardArchived;board.archivedCards=fixture.archivedCards;}
 return state;
}
export async function manageContentLifecycle(data){
 fixture.lifecycleCalls.push(data);
 if(data.cardId)fixture.archivedCards=fixture.archivedCards.filter(c=>c.id!==data.cardId);
 else if(data.action==='delete')fixture.boardDeleted=true;
 else fixture.boardArchived=data.action==='archive';
 return {boardId:data.boardId,cardId:data.cardId,action:data.action};
}
