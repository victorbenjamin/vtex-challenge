import type { Knex } from 'knex';

// 006: NameSynonym, words sellers use mapped to the words the catalog uses (the catalog is
// in English, some sellers write in Portuguese). Applied only to seller entries, one word
// at a time, so the catalog and Product.NormalizedName never change when synonyms do:
// operations can add a synonym and the next import uses it, with no migration.

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE NameSynonym (
      Term        TEXT PRIMARY KEY COLLATE NOCASE
                  CHECK (length(trim(Term)) > 0 AND instr(trim(Term), ' ') = 0),
      Replacement TEXT NOT NULL CHECK (length(trim(Replacement)) > 0)
    )`);

  // The two translations found in the challenge data (#57 and #64).
  await knex.raw(
    `INSERT INTO NameSynonym (Term, Replacement) VALUES
       ('roteador', 'router'),
       ('processador', 'processor')`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE NameSynonym');
}
