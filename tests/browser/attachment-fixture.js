export const fixture={calls:[],fail:false,held:null,clear:0,released:[],downloads:0};
export async function uploadAttachment(file,boardId,cardId,requestId,progress){fixture.calls.push({file,boardId,cardId,requestId});progress(50);if(fixture.fail){fixture.fail=false;throw Error('測試連線失敗');}if(fixture.held)await fixture.held;return {attachmentId:'file'};}
export async function attachmentBlobURL(){fixture.downloads++;return URL.createObjectURL(new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8l8AAAAASUVORK5CYII='),c=>c.charCodeAt(0))],{type:'image/png'}));}
export function releaseAttachmentURL(url){fixture.released.push(url);URL.revokeObjectURL(url);}
export function clearAttachmentAccess(){fixture.clear++;}
