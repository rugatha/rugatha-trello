// Preferences browser tests use only in-memory records, never production Firebase.
export * from './phase5-fixture.js';
import {fixture, loadWorkspace as baseLoad} from './phase5-fixture.js';
const baseLogin = fixture.login;
fixture.login = async (...args) => {
  await baseLogin(...args);
  if (fixture.member) fixture.snapshot({accessboard:['b','second','new','old']});
};
export async function loadWorkspace(account) {
  const state = await baseLoad(account);
  if (state.boards.length) {
    state.users = account.roster;
    state.boards.push(...[
      ['second','第二個看板',false],['new','新加入的看板',false],['old','封存看板',true]
    ].map(([id,name,archived])=>({id,name,archived,columns:[],cards:[],archivedCards:[]})));
  }
  return state;
}
