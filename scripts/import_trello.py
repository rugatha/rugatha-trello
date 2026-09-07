"""Convert local Trello exports to Boardly data. No remote requests or source edits."""
import json
from pathlib import Path
from datetime import datetime, timezone
from collections import Counter

ROOT = Path(__file__).resolve().parent.parent
FILES = sorted((ROOT / 'import').glob('*.json'))
state = json.loads((ROOT / 'data.json').read_text())
state['boards'] = [b for b in state['boards'] if not b.get('trelloId') and b['id'] != 'demo' and b.get('cards')]
saved_short_names = {u['id']: u.get('shortName', u['name'][:1]) for u in state['users']}
state['users'] = [u for u in state['users'] if not u.get('trelloId')]
users = {u['id']: u for u in state['users']}
member_map = {}
reports = []

def member(m):
    mid = m['id']
    if mid in member_map:
        return member_map[mid]
    name = m.get('fullName') or m.get('username') or ('Trello ' + mid[-6:])
    alias = next((a for a in state.get('userAliases', []) if a.get('trelloId') == mid or a['sourceName'] == name), None)
    match = users.get(alias['targetId']) if alias else next((u for u in users.values() if u['name'] == name), None)
    ident = match['id'] if match else 'trello-user-' + mid
    if not match:
        users[ident] = dict(id=ident, name=name, shortName=saved_short_names.get(ident, name[:1]), color='#e4e9dd', trelloId=mid,
                            trelloUsername=m.get('username', ''))
    member_map[mid] = ident
    return ident

def created(cid):
    return datetime.fromtimestamp(int(cid[:8], 16), timezone.utc).isoformat().replace('+00:00', 'Z')

for path in FILES:
    raw = json.loads(path.read_text())
    if not isinstance(raw, dict) or not all(k in raw for k in ('cards', 'lists', 'id', 'name')):
        raise ValueError(f'Not a Trello board: {path.name}')
    for m in raw.get('members', []): member(m)
    for action in raw.get('actions', []):
        if action.get('memberCreator'): member(action['memberCreator'])
    columns = [dict(id=l['id'], name=l['name'] + ('（已封存階段）' if l.get('closed') else ''),
                    archived=bool(l.get('closed')), trelloName=l['name'])
               for l in sorted(raw['lists'], key=lambda x:x.get('pos', 0))]
    archive_id = 'trello-archive-' + raw['id']
    if any(c.get('closed') for c in raw['cards']):
        columns.append(dict(id=archive_id, name='已封存卡片', archived=True))
    comments = {}
    for a in raw.get('actions', []):
        if a['type'] != 'commentCard': continue
        cid = a.get('data', {}).get('card', {}).get('id')
        m = a.get('memberCreator') or dict(id=a.get('idMemberCreator', 'unknown'), fullName='未知 Trello 成員')
        comments.setdefault(cid, []).append(dict(id=a['id'], userId=member(m),
            username=users[member(m)]['name'], originalUsername=m.get('username') or m.get('fullName') or '未知 Trello 成員',
            text=a['data'].get('text', ''), at=a['date']))
    checklists = {x['id']:x for x in raw.get('checklists', [])}
    definitions = {}
    for l in raw.get('labels', []):
        color = (l.get('color') or 'orange').split('_')[0]
        color = {'yellow':'orange', 'red':'pink', 'lime':'green', 'sky':'blue', 'black':'purple'}.get(color, color)
        if color not in ('purple','blue','green','orange','pink'): color='orange'
        definitions[l['id']] = dict(name=l.get('name') or l.get('color') or '標籤', color=color,
                                    trelloColor=l.get('color'))
    cards=[]
    for c in sorted(raw['cards'], key=lambda x:x.get('pos',0)):
        todos=[]
        for checklist_id in c.get('idChecklists', []):
            group=checklists.get(checklist_id)
            if group is None: raise ValueError(f'Missing checklist {checklist_id}')
            for item in sorted(group.get('checkItems',[]),key=lambda x:x.get('pos',0)):
                todos.append(dict(id=item['id'], text=item['name'], done=item.get('state')=='complete',
                                  group=group['name'], groupId=group['id'], due=item.get('due'),
                                  trelloMemberId=item.get('idMember')))
        attachments=[dict(id=a['id'], name=a['name'], type=a.get('mimeType') or '',
                          size=a.get('bytes') or 0, url=a['url'], trelloDate=a.get('date'),
                          external=True, isUpload=bool(a.get('isUpload')))
                     for a in sorted(c.get('attachments', []), key=lambda x:x.get('pos',0))]
        assigned=[member(dict(id=mid,fullName='Trello '+mid[-6:])) for mid in c.get('idMembers',[])]
        column_id=archive_id if c.get('closed') else c['idList']
        if not any(x['id']==column_id for x in columns):
            columns.append(dict(id=column_id,name='未列出的原始階段'))
        cards.append(dict(id=c['id'], title=c['name'], columnId=column_id, description=c.get('desc') or '',
            labels=c.get('idLabels',[]), assignees=assigned, due=c.get('due') or '', done=bool(c.get('dueComplete')),
            checklist=todos, attachments=attachments, comments=sorted(comments.get(c['id'],[]),key=lambda x:x['at']),
            createdAt=created(c['id']), coverId=c.get('idAttachmentCover'), trelloId=c['id'],
            trelloUrl=c.get('url'), archived=bool(c.get('closed')), originalColumnId=c['idList'],
            trelloStart=c.get('start'), trelloLastActivity=c.get('dateLastActivity')))
    board=dict(id='trello-'+raw['id'], trelloId=raw['id'], name=raw['name'], description=raw.get('desc') or '',
               color='#455f56', archived=raw['name'] in ('2027長團', '2027 長團', 'Illustration'), columns=columns, cards=cards, labelDefinitions=definitions,
               sourceFile=path.name, trelloUrl=raw.get('url'))
    state['boards'].append(board)
    reports.append(dict(file=path.name, board=raw['name'], cards=len(cards),
        archived=sum(c['archived'] for c in cards), lists=len(raw['lists']),
        checklistItems=sum(len(c['checklist']) for c in cards), comments=sum(len(c['comments']) for c in cards),
        attachmentLinks=sum(len(c['attachments']) for c in cards),
        commentsOnAbsentCards=sum(len(v) for k,v in comments.items() if k not in {c['id'] for c in cards}),
        commentCountInBadges=sum(c.get('badges',{}).get('comments',0) for c in raw['cards']),
        exportedActions=len(raw.get('actions',[]))))
state['users']=list(users.values())
state['activeBoard']=next((b['id'] for b in state['boards'] if not b.get('archived')), state['boards'][0]['id'])
state['trelloImportVersion']=1
state['removedDemoUsersVersion']=1
state['removedDmUserVersion']=1
(ROOT/'data.json').write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n')
(ROOT/'import-report.json').write_text(json.dumps(dict(boards=reports,
    notes=['附件只保留原始網址；未下載二進位檔案。',
           '只匯入備份中存在的留言；缺少的歷史動作無法由此備份還原。',
           '已封存卡片移至「已封存卡片」欄，保留原階段 ID；封存階段另有名稱標記。',
           'Trello 成員依 data.json 的 userAliases 合併，未列出者才保留來源身分。']),ensure_ascii=False,indent=2)+'\n')
print(json.dumps(reports,ensure_ascii=False,indent=2))
