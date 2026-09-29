"""Import the versioned Boardly seed into the rugatha-trello Firestore database.

Uses Cloud Shell's gcloud login and Python's standard library. Run without
--apply to inspect the source; --apply creates missing documents only.
"""

import argparse
import hashlib
import json
import subprocess
import urllib.error
import urllib.request
from pathlib import Path


PROJECT_ID = "rugatha-trello"
DATABASE = "(default)"
WORKSPACE_ID = "main"
ROOT = f"projects/{PROJECT_ID}/databases/{DATABASE}/documents"
API = "https://firestore.googleapis.com/v1"
BATCH_SIZE = 200


def firestore_value(value):
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, str):
        return {"stringValue": value}
    if isinstance(value, list):
        return {"arrayValue": {"values": [firestore_value(item) for item in value]}}
    if isinstance(value, dict):
        return {"mapValue": {"fields": {key: firestore_value(item) for key, item in value.items()}}}
    raise TypeError(f"Unsupported value: {type(value).__name__}")


def document(path, fields):
    return {"name": f"{ROOT}/{path}", "fields": {key: firestore_value(value) for key, value in fields.items()}}


def request(method, path, token, payload=None):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{API}/{path}",
        data=data,
        method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        if error.code == 404 and method == "GET":
            return None
        raise RuntimeError(f"Firestore HTTP {error.code}: {detail[:1000]}") from error


def source_documents(source):
    base = f"workspaces/{WORKSPACE_ID}"
    for user in source["users"]:
        yield f"{base}/legacyMembers/{user['id']}", {
            **user,
            "legacyId": user["id"],
            "authUid": None,
            "accountLinkStatus": "unlinked",
        }
    for board_index, board in enumerate(source["boards"]):
        board_path = f"{base}/boards/{board['id']}"
        yield board_path, {
            **{key: value for key, value in board.items() if key not in ("columns", "cards")},
            "orderKey": f"{board_index:08d}",
            "cardCount": len(board["cards"]),
        }
        for column_index, column in enumerate(board["columns"]):
            yield f"{board_path}/columns/{column['id']}", {**column, "orderKey": f"{column_index:08d}"}
        for card_index, card in enumerate(board["cards"]):
            card_path = f"{board_path}/cards/{card['id']}"
            yield card_path, {
                **{key: value for key, value in card.items() if key not in ("checklist", "comments", "attachments", "assignees")},
                "legacyAssigneeIds": card["assignees"],
                "assigneeUids": [],
                "orderKey": f"{card_index:08d}",
                "checklistCount": len(card["checklist"]),
                "commentCount": len(card["comments"]),
                "attachmentCount": len(card["attachments"]),
            }
            for index, item in enumerate(card["checklist"]):
                yield f"{card_path}/checklist/{item['id']}", {**item, "orderKey": f"{index:08d}"}
            for item in card["comments"]:
                yield f"{card_path}/comments/{item['id']}", {
                    **{key: value for key, value in item.items() if key != "userId"},
                    "legacyUserId": item["userId"],
                    "authorUid": None,
                }
            for item in card["attachments"]:
                if "data" in item:
                    raise ValueError(f"Inline attachment {item['id']} needs a Storage migration before import")
                yield f"{card_path}/attachments/{item['id']}", {
                    **item,
                    "storagePath": None,
                    "migrationStatus": "external_link_only",
                }


def apply_import(source, source_hash, documents):
    token = subprocess.check_output(["gcloud", "auth", "print-access-token"], text=True).strip()
    root_path = f"workspaces/{WORKSPACE_ID}"
    existing = request("GET", f"{ROOT}/{root_path}", token)
    if existing:
        fields = existing.get("fields", {})
        previous_hash = fields.get("seedSha256", {}).get("stringValue")
        if previous_hash != source_hash:
            raise RuntimeError("Workspace already exists with a different seed; refusing to overwrite it")
        if fields.get("migrationState", {}).get("stringValue") == "complete":
            print("This seed is already imported; no writes made.")
            return
    else:
        request("PATCH", f"{ROOT}/{root_path}", token, document(root_path, {
            "name": "rugatha-trello",
            "schemaVersion": 1,
            "seedSha256": source_hash,
            "migrationState": "in_progress",
            "legacyUserAliases": source.get("userAliases", []),
        }))

    created = 0
    already_present = 0
    for offset in range(0, len(documents), BATCH_SIZE):
        chunk = documents[offset:offset + BATCH_SIZE]
        writes = [{"update": document(path, fields), "currentDocument": {"exists": False}} for path, fields in chunk]
        response = request("POST", f"{ROOT}:batchWrite", token, {"writes": writes})
        for status in response.get("status", []):
            code = status.get("code", 0)
            if code == 0:
                created += 1
            elif code == 6:  # ALREADY_EXISTS, from a previous interrupted run
                already_present += 1
            else:
                raise RuntimeError(f"Import stopped after {created} new documents: {status}")
        print(f"Processed {min(offset + BATCH_SIZE, len(documents))}/{len(documents)} documents")

    request("PATCH", f"{ROOT}/{root_path}?updateMask.fieldPaths=migrationState", token,
            document(root_path, {"migrationState": "complete"}))
    print(f"Import complete: {created} created, {already_present} already present")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Boardly workspace JSON (default: data.json)", nargs="?", default=Path("data.json"))
    parser.add_argument("--apply", action="store_true", help="Write to the rugatha-trello Firestore database")
    args = parser.parse_args()
    raw = args.source.read_bytes()
    source = json.loads(raw)
    if source.get("version") != 1:
        raise ValueError("Expected Boardly workspace version 1")
    documents = list(source_documents(source))
    kinds = {name: sum(path.split("/")[-2] == name for path, _ in documents)
             for name in ("legacyMembers", "boards", "columns", "cards", "checklist", "comments", "attachments")}
    print(f"Source: {args.source} SHA-256 {hashlib.sha256(raw).hexdigest()}")
    print(f"Documents: {len(documents)}; {kinds}")
    if args.apply:
        apply_import(source, hashlib.sha256(raw).hexdigest(), documents)
    else:
        print("Dry run only; pass --apply to create Firestore documents")


if __name__ == "__main__":
    main()
