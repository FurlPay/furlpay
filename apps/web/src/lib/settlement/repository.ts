import {
  sbInsertIgnoreDuplicates,
  sbSelect,
  sbUpdate,
  supabaseBackend,
} from "@/lib/supabase";
import { draftSchema, type Draft, type WorkspaceRecord } from "./model";

type Row = {
  id: string;
  owner_id: string;
  payload: Draft;
  created_at: string;
  archived_at: string | null;
};
const TABLE = "settlement_workspace_records";
const ownerFilter = (owner: string) =>
  `owner_id=eq.${encodeURIComponent(owner)}`;
export class WorkspaceUnavailable extends Error {}
export class RecordConflict extends Error {}
function configured() {
  if (supabaseBackend !== "supabase")
    throw new WorkspaceUnavailable("Draft storage is not configured");
}
function publicRecord(row: Row): WorkspaceRecord {
  return {
    id: row.id,
    data: draftSchema.parse(row.payload),
    createdAt: row.created_at,
    archivedAt: row.archived_at,
  };
}
export async function listRecords(owner: string): Promise<WorkspaceRecord[]> {
  configured();
  const rows = await sbSelect<Row>(
    TABLE,
    `${ownerFilter(owner)}&order=created_at.desc,id.desc&limit=500`
  );
  return rows.map(publicRecord);
}
export async function saveRecord(
  owner: string,
  id: string,
  payload: Draft
): Promise<WorkspaceRecord> {
  configured();
  // Composite PK makes retries idempotent without overwriting or claiming
  // another account's record. Canonical Zod parsing strips no unknown fields:
  // schemas are strict, and amounts/addresses have already been validated.
  await sbInsertIgnoreDuplicates<Row>(TABLE, {
    id,
    owner_id: owner,
    payload,
    created_at: new Date().toISOString(),
    archived_at: null,
  });
  const [row] = await sbSelect<Row>(
    TABLE,
    `${ownerFilter(owner)}&id=eq.${encodeURIComponent(id)}&limit=1`
  );
  if (!row) throw new WorkspaceUnavailable("Draft could not be read back");
  if (
    JSON.stringify(draftSchema.parse(row.payload)) !==
    JSON.stringify(draftSchema.parse(payload))
  )
    throw new RecordConflict("This request ID belongs to a different draft");
  return publicRecord(row);
}
export async function archiveRecord(
  owner: string,
  id: string
): Promise<boolean> {
  configured();
  const rows = await sbUpdate<Row>(
    TABLE,
    `${ownerFilter(owner)}&id=eq.${encodeURIComponent(id)}`,
    { archived_at: new Date().toISOString() }
  );
  return rows.length === 1;
}
