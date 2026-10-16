import { randomUUID } from "node:crypto";
import { nowIso, queryOne, runQuery } from "../../common/db/index.js";
import { ApiError, nameKey } from "../../common/utils/index.js";
import type { PersonKind } from "../graph/index.js";
import type { AddPersonInput } from "./case.schema.js";
import { requireCase } from "./case.service.js";

export interface PersonView {
  id: string;
  name: string;
  kind: PersonKind;
  role: string | null; // parties only
  code: string | null; // witnesses only (PW1, DW2)
  witnessType: string | null;
  enrolmentNo: string | null;
  represents: { id: string; name: string; from: string | null; to: string | null }[];
  calledBy: { id: string; name: string } | null;
}

const LABEL: Record<AddPersonInput["kind"], PersonKind> = {
  party: "Party",
  lawyer: "Lawyer",
  judge: "Judge",
  witness: "Witness",
};

async function requireParty(caseId: string, partyId: string) {
  const row = await queryOne("MATCH (p:Party {id: $partyId, caseId: $caseId}) RETURN p.id AS id", { caseId, partyId });
  if (!row) throw ApiError.badRequest("Party not found in this case");
}

/**
 * Adds a party, lawyer, judge or witness to a case. People are scoped to the case and
 * de-duplicated by normalised name, so adding "Adv. R. Mehta" twice returns the same node.
 */
export async function addPerson(caseId: string, input: AddPersonInput): Promise<{ person: PersonView; created: boolean }> {
  await requireCase(caseId);
  if (input.kind === "lawyer") await requireParty(caseId, input.representsId);
  if (input.kind === "witness" && input.calledById) await requireParty(caseId, input.calledById);

  const label = LABEL[input.kind];
  const key = nameKey(input.name);
  const now = nowIso();

  const existing = await queryOne<{ id: string }>(
    `MATCH (p:${label} {caseId: $caseId, nameKey: $key}) RETURN p.id AS id`,
    { caseId, key },
  );
  const id = existing?.id ?? randomUUID();

  if (!existing) {
    await runQuery(
      `CREATE (p:Person:${label} {id: $id, caseId: $caseId, name: $name, nameKey: $key, createdAt: $now})
       SET p += $extra`,
      {
        id,
        caseId,
        name: input.name,
        key,
        now,
        extra:
          input.kind === "lawyer"
            ? { enrolmentNo: input.enrolmentNo ?? null }
            : input.kind === "witness"
              ? { code: input.code ?? null, witnessType: input.witnessType }
              : {},
      },
    );
  }

  // Relationships are added even for an existing person (e.g. a lawyer taking on a second party).
  switch (input.kind) {
    case "party":
      await runQuery(
        `MATCH (p:Party {id: $id}), (c:Case {id: $caseId})
         WHERE NOT (p)-[:PARTY_IN]->(c)
         CREATE (p)-[:PARTY_IN {role: $role}]->(c)`,
        { id, caseId, role: input.role },
      );
      break;
    case "lawyer":
      await runQuery(
        `MATCH (l:Lawyer {id: $id}), (p:Party {id: $partyId})
         WHERE NOT (l)-[:REPRESENTS]->(p)
         CREATE (l)-[:REPRESENTS {from: $from, to: null}]->(p)`,
        { id, partyId: input.representsId, from: input.from ?? null },
      );
      break;
    case "witness":
      if (input.calledById) {
        await runQuery(
          `MATCH (w:Witness {id: $id}), (p:Party {id: $partyId})
           WHERE NOT (w)-[:CALLED_BY]->(p)
           CREATE (w)-[:CALLED_BY]->(p)`,
          { id, partyId: input.calledById },
        );
      }
      break;
  }

  const person = (await listPeople(caseId)).find((p) => p.id === id)!;
  return { person, created: !existing };
}

export async function listPeople(caseId: string): Promise<PersonView[]> {
  await requireCase(caseId);
  const rows = await runQuery<Omit<PersonView, "kind"> & { labels: string[] }>(
    `MATCH (p:Person {caseId: $caseId})
     OPTIONAL MATCH (p)-[pi:PARTY_IN]->(:Case)
     OPTIONAL MATCH (p)-[r:REPRESENTS]->(rp:Party)
     OPTIONAL MATCH (p)-[:CALLED_BY]->(cb:Party)
     WITH p, pi, cb, collect(CASE WHEN rp IS NULL THEN NULL ELSE {id: rp.id, name: rp.name, from: r.from, to: r.to} END) AS represents
     RETURN p.id AS id, p.name AS name, labels(p) AS labels, pi.role AS role, p.code AS code,
            p.witnessType AS witnessType, p.enrolmentNo AS enrolmentNo, represents,
            CASE WHEN cb IS NULL THEN NULL ELSE {id: cb.id, name: cb.name} END AS calledBy
     ORDER BY p.createdAt`,
    { caseId },
  );
  return rows.map(({ labels, ...p }) => ({
    ...p,
    kind: labels.find((l) => l !== "Person") as PersonKind,
  }));
}
