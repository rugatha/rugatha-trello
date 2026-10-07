import { auth } from './auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
const functions = getFunctions(auth.app, 'asia-east1');
async function call(name, data) {
  try { return (await httpsCallable(functions, name, {timeout:30000})(data)).data; }
  catch (error) {
    if (['functions/unavailable','functions/not-found','functions/internal'].includes(error.code)) {
      throw new Error('管理服務尚未就緒或暫時無法連線，請稍後重試');
    }
    throw error;
  }
}
export const listManagementMembers = data => call('listManagementMembers', data);
export const createManagedBoard = data => call('createManagedBoard', data);
export const setManagedAssignees = data => call('setManagedAssignees', data);
