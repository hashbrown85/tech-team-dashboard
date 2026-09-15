// @ts-check
/**
 * How the board's records map onto SharePoint lists.
 *
 * ONE SOURCE OF TRUTH. This file drives two things that must never disagree:
 * the adapter that reads and writes the lists, and tools/provision.mjs, which
 * emits the PowerShell that creates them. If a column is added here it appears
 * in both; if it were written twice, they would drift and the failure would be
 * a field silently not saving.
 *
 * ## Four decisions worth understanding
 *
 * **The app's id lives in `Title`.** SharePoint assigns its own integer id on
 * create and will not let you choose one, but undo restores records under their
 * ORIGINAL ids and everything points at them by id. So each item carries the
 * app's id in a column, and the adapter keeps a private map from app id to
 * SharePoint item id. `Title` is used for it because every list has one, it is
 * indexable, and it is required by default — putting the id there means no
 * fighting with an empty required field on every write.
 *
 * **Every column name is one word.** A column called "Estimated Value" gets an
 * internal name like `Estimated_x0020_Value`, and Graph will not tell you the
 * internal names — you would need the older SharePoint REST API to find out.
 * Single words keep internal and display names identical.
 *
 * **Arrays are JSON in a text column.** members, detailAreas, resources and the
 * rest. Justified in DATA_MODEL.md: every place in the app reads or writes the
 * whole array at once, and nothing ever queries "which tabs contain person X"
 * from the store. Junction lists would triple the writes and buy nothing.
 *
 * **No Yes/No columns.** The Power BI SharePoint connector is known to surface
 * booleans inconsistently as TRUE/FALSE or 1/0 depending on where the report
 * runs, which quietly breaks filters. `autoResolved` is stored as a Number, 1 or
 * 0, which every consumer reads the same way.
 */

/** The column holding the app's own record id, on every list. */
export const KEY_COLUMN = 'Title';

/**
 * Field kinds, and how each survives the round trip.
 *   text   - a string; absent becomes ''
 *   note   - multi-line text; same handling, different column type
 *   number - a number; absent stays absent rather than becoming 0
 *   date   - a 'YYYY-MM-DD' string, stored as text so no timezone can shift it
 *   json   - an array or object, stored as JSON in a multi-line text column
 *   flag   - a boolean, stored as the number 1 or 0 (see above)
 */

/**
 * @typedef {{col: string, kind: 'text'|'note'|'number'|'date'|'json'|'flag'}} FieldSpec
 * @typedef {{list: string, indexes: string[], fields: Record<string, FieldSpec>}} ListSpec
 */

/** @type {Record<string, ListSpec>} */
export const SCHEMA = {
  people: {
    list: 'BoardPeople',
    indexes: [],
    fields: {
      name: { col: 'PersonName', kind: 'text' },
      title: { col: 'JobTitle', kind: 'text' },
      home: { col: 'HomeArea', kind: 'text' },
      detailAreas: { col: 'DetailAreasJson', kind: 'json' },
      // Set by the SSO work in Phase 2: match the signed-in user to a person.
      upn: { col: 'Upn', kind: 'text' }
    }
  },

  tabs: {
    list: 'BoardMeetings',
    indexes: [],
    fields: {
      name: { col: 'MeetingName', kind: 'text' },
      kind: { col: 'Kind', kind: 'text' },
      weekday: { col: 'Weekday', kind: 'number' },
      lengthMin: { col: 'LengthMin', kind: 'number' },
      members: { col: 'MembersJson', kind: 'json' },
      support: { col: 'SupportJson', kind: 'json' },
      optional: { col: 'OptionalJson', kind: 'json' }
    }
  },

  entries: {
    // The fastest-growing list: roughly 100 rows a week across a dozen meetings,
    // so about 5,000 in a year. Both filter columns are indexed, though Graph can
    // only use one index per query.
    list: 'BoardEntries',
    indexes: ['Tab', 'MeetingDate'],
    fields: {
      tab: { col: 'Tab', kind: 'text' },
      meeting: { col: 'MeetingDate', kind: 'date' },
      personId: { col: 'PersonId', kind: 'text' },
      kind: { col: 'Kind', kind: 'text' },
      text: { col: 'Body', kind: 'note' },
      why: { col: 'Why', kind: 'note' },
      change: { col: 'ChangeText', kind: 'note' },
      projectId: { col: 'ProjectId', kind: 'text' }
    }
  },

  projects: {
    list: 'BoardProjects',
    indexes: ['Tab'],
    fields: {
      tab: { col: 'Tab', kind: 'text' },
      personId: { col: 'PersonId', kind: 'text' },
      name: { col: 'ProjectName', kind: 'text' },
      status: { col: 'Status', kind: 'text' },
      due: { col: 'DueDate', kind: 'date' },
      start: { col: 'StartDate', kind: 'date' },
      added: { col: 'AddedMeeting', kind: 'date' },
      fromOpp: { col: 'FromOpp', kind: 'text' },
      note: { col: 'Note', kind: 'note' },
      statusMeeting: { col: 'StatusMeeting', kind: 'date' },
      prevStatus: { col: 'PrevStatus', kind: 'text' },
      doneMeeting: { col: 'DoneMeeting', kind: 'date' },
      rank: { col: 'Rank', kind: 'number' },
      estValue: { col: 'EstValue', kind: 'number' },
      winPct: { col: 'WinPct', kind: 'number' },
      winReason: { col: 'WinReason', kind: 'note' },
      resources: { col: 'ResourcesJson', kind: 'json' },
      chemistries: { col: 'ChemistriesJson', kind: 'json' }
    }
  },

  issues: {
    list: 'BoardIssues',
    indexes: ['Tab'],
    fields: {
      tab: { col: 'Tab', kind: 'text' },
      personId: { col: 'PersonId', kind: 'text' },
      text: { col: 'Body', kind: 'note' },
      sev: { col: 'Severity', kind: 'text' },
      status: { col: 'Status', kind: 'text' },
      meeting: { col: 'MeetingDate', kind: 'date' },
      rank: { col: 'Rank', kind: 'number' },
      resolvedMeeting: { col: 'ResolvedMeeting', kind: 'date' },
      autoResolved: { col: 'AutoResolved', kind: 'flag' }
    }
  },

  actions: {
    list: 'BoardActions',
    indexes: ['Tab', 'Status'],
    fields: {
      num: { col: 'ActionNum', kind: 'number' },
      tab: { col: 'Tab', kind: 'text' },
      text: { col: 'Body', kind: 'note' },
      // Names, not ids — what the app stores today. The owner-id migration is
      // planned; when it lands, OwnerId and SupportId join these.
      owner: { col: 'Owner', kind: 'text' },
      support: { col: 'SupportPerson', kind: 'text' },
      due: { col: 'DueDate', kind: 'date' },
      status: { col: 'Status', kind: 'text' },
      doneOn: { col: 'DoneOn', kind: 'date' },
      meeting: { col: 'MeetingDate', kind: 'date' }
      // `parent` is handled specially — see parentToFields below. It is stored as
      // two plain columns rather than JSON so Power BI can read it directly.
    }
  },

  meetings: {
    // Key is 'tabId@YYYY-MM-DD'. Held in memory keyed 'tabId|YYYY-MM-DD'.
    list: 'BoardMeetingRecords',
    indexes: [],
    fields: {
      ratings: { col: 'RatingsJson', kind: 'json' },
      note: { col: 'Note', kind: 'note' }
    }
  },

  settings: {
    // Two rows: Key 'chemistries' and Key 'resources'.
    list: 'BoardSettings',
    indexes: [],
    fields: {
      items: { col: 'ItemsJson', kind: 'json' }
    }
  }
};

/** The counter list, outside SCHEMA because the app never subscribes to it. */
export const COUNTER_LIST = 'BoardCounters';
export const COUNTER_KEY = 'actions';
export const COUNTER_COLUMN = 'NextNum';

/** Columns holding an action's polymorphic parent pointer. */
export const PARENT_TYPE_COLUMN = 'ParentType';
export const PARENT_KEY_COLUMN = 'ParentKey';

/* ---------------------------------------------------------------- mapping */

/**
 * Turn an app document into the `fields` object Graph expects.
 *
 * Absent fields are written as empty rather than skipped, so clearing a value
 * actually clears it — a patch that omits a key leaves the old value in place,
 * which would make `delete x.rank` silently fail to take effect.
 *
 * @param {string} col - collection name
 * @param {string} id - the app's record id, written to the key column
 * @param {any} doc
 * @returns {Record<string, any>}
 */
export function toFields(col, id, doc) {
  const spec = SCHEMA[col];
  if (!spec) throw new Error('No schema for collection: ' + col);

  /** @type {Record<string, any>} */
  const out = {};
  out[KEY_COLUMN] = id;

  Object.keys(spec.fields).forEach(function (appField) {
    const f = spec.fields[appField];
    const v = doc ? doc[appField] : undefined;

    if (f.kind === 'json') {
      out[f.col] = v == null ? '' : JSON.stringify(v);
    } else if (f.kind === 'number') {
      out[f.col] = v == null || v === '' ? null : Number(v);
    } else if (f.kind === 'flag') {
      out[f.col] = v ? 1 : 0;
    } else {
      out[f.col] = v == null ? '' : String(v);
    }
  });

  if (col === 'actions') {
    const parent = doc && doc.parent;
    out[PARENT_TYPE_COLUMN] = parent ? String(parent.type) : '';
    out[PARENT_KEY_COLUMN] = parent ? String(parent.id) : '';
  }

  return out;
}

/**
 * Turn a Graph list item back into an app document.
 *
 * Empty text comes back as an ABSENT field rather than '', because the app
 * distinguishes the two: `'prevStatus' in project` is a real question that
 * decides what the meeting summary says.
 *
 * @param {string} col
 * @param {Record<string, any>} fields
 * @returns {any} the document, including its `id`
 */
export function fromFields(col, fields) {
  const spec = SCHEMA[col];
  if (!spec) throw new Error('No schema for collection: ' + col);

  /** @type {any} */
  const doc = { id: fields[KEY_COLUMN] };

  Object.keys(spec.fields).forEach(function (appField) {
    const f = spec.fields[appField];
    const raw = fields[f.col];

    if (f.kind === 'json') {
      if (raw === '' || raw == null) return;
      try {
        doc[appField] = JSON.parse(raw);
      } catch (e) {
        // A hand-edited cell should not take the whole board down.
        doc[appField] = undefined;
      }
      if (doc[appField] === undefined) delete doc[appField];
    } else if (f.kind === 'number') {
      if (raw == null || raw === '') return;
      doc[appField] = Number(raw);
    } else if (f.kind === 'flag') {
      if (Number(raw) === 1) doc[appField] = true;
    } else {
      if (raw == null || raw === '') return;
      doc[appField] = String(raw);
    }
  });

  if (col === 'actions') {
    const type = fields[PARENT_TYPE_COLUMN];
    const key = fields[PARENT_KEY_COLUMN];
    doc.parent = type && key ? { type: String(type), id: String(key) } : null;
  }

  return doc;
}

/** Every column a list needs, for the provisioning script. */
export function columnsFor(col) {
  const spec = SCHEMA[col];
  const cols = Object.keys(spec.fields).map(function (k) {
    return { name: spec.fields[k].col, kind: spec.fields[k].kind };
  });
  if (col === 'actions') {
    cols.push({ name: PARENT_TYPE_COLUMN, kind: 'text' });
    cols.push({ name: PARENT_KEY_COLUMN, kind: 'text' });
  }
  return cols;
}

/**
 * Which SharePoint field type each kind needs.
 *
 * Dates are deliberately Text: the app stores 'YYYY-MM-DD' strings and compares
 * them as text. A real DateTime column would round-trip through a timezone and
 * could come back a day out, which would file an entry against the wrong meeting.
 */
export const SP_FIELD_TYPE = {
  text: 'Text',
  note: 'Note',
  number: 'Number',
  date: 'Text',
  json: 'Note',
  flag: 'Number'
};
