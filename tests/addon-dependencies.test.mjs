import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addonDependents,
  backgroundAddonDependencies,
  parseAddonRequirements,
  requiredAddonDependencies,
  requiredAddonDependencyMap,
  resolveAddonDependencies,
  validateAddonRequirements,
} from '../src/shared/addon-dependencies.ts'

const addon = (id, ...addons) => ({
  id,
  requires: {
    addons: addons.map((entry) =>
      typeof entry === 'string' ? { id: entry } : entry,
    ),
  },
})
const enabled = (...ids) => ids.map((id) => ({ id, enabled: true }))

test('requirements may be absent or empty and parsed entries are copied', () => {
  assert.equal(parseAddonRequirements(undefined, 'owner'), undefined)
  assert.deepEqual(parseAddonRequirements({ addons: [] }, 'owner'), {
    addons: [],
  })
  const input = {
    addons: [
      { id: 'markdown' },
      { id: 'syntax-2', optional: false },
      { id: 'colors', optional: true },
    ],
  }
  assert.deepEqual(parseAddonRequirements(input, 'owner'), input)
  const parsed = parseAddonRequirements(input, 'owner')
  assert.notStrictEqual(parsed, input)
  assert.notStrictEqual(parsed.addons, input.addons)
  assert.notStrictEqual(parsed.addons[0], input.addons[0])
})

test('requirements reject malformed containers with owner and reason', () => {
  for (const value of [
    null,
    false,
    1,
    'markdown',
    [],
    {},
    { addons: null },
    { addons: 'markdown' },
    { addons: [], extra: true },
  ])
    assert.throws(
      () => parseAddonRequirements(value, 'owner'),
      /owner.*addons array/,
    )
})

test('requirements reject malformed entries and unknown fields', () => {
  for (const entry of [
    null,
    false,
    1,
    'markdown',
    [],
    { id: 'markdown', extra: true },
  ])
    assert.throws(
      () => parseAddonRequirements({ addons: [entry] }, 'owner'),
      /object with an id|only id and optional/,
    )
  assert.throws(
    () => parseAddonRequirements({ addons: Array(1) }, 'owner'),
    /object with an id/,
  )
})

test('requirements enforce existing addon id format', () => {
  for (const id of [
    undefined,
    null,
    1,
    '',
    'Markdown',
    'two words',
    '1addon',
    '../addon',
    'addon.name',
    'addon_name',
    'addon\n',
  ])
    assert.throws(
      () => parseAddonRequirements({ addons: [{ id }] }, 'owner'),
      /dependency id must match/,
    )
})

test('requirements reject self dependencies even when optional', () => {
  for (const optional of [false, true])
    assert.throws(
      () =>
        parseAddonRequirements(
          { addons: [{ id: 'owner', optional }] },
          'owner',
        ),
      /owner.*cannot require itself/,
    )
})

test('requirements reject duplicate ids across required and optional entries', () => {
  assert.throws(
    () =>
      parseAddonRequirements(
        { addons: [{ id: 'markdown' }, { id: 'markdown', optional: true }] },
        'owner',
      ),
    /duplicate dependency "markdown"/,
  )
})

test('requirements require boolean optional flags', () => {
  for (const optional of [null, 0, 1, 'true', {}, []])
    assert.throws(
      () =>
        parseAddonRequirements(
          { addons: [{ id: 'markdown', optional }] },
          'owner',
        ),
      /markdown.*optional must be a boolean/,
    )
})

test('requirements accept 32 dependencies and reject 33', () => {
  const addons = Array.from({ length: 32 }, (_, index) => ({
    id: `addon-${index}`,
  }))
  assert.equal(parseAddonRequirements({ addons }, 'owner').addons.length, 32)
  assert.throws(
    () =>
      parseAddonRequirements({ addons: [...addons, { id: 'extra' }] }, 'owner'),
    /at most 32/,
  )
})

test('resolver loads enabled dependencies before consumers and preserves unrelated order', () => {
  const manifests = [
    addon('consumer', 'middle', 'base'),
    addon('unrelated'),
    addon('middle', 'base'),
    addon('base'),
    addon('disabled'),
  ]
  assert.deepEqual(
    resolveAddonDependencies(
      manifests,
      enabled('consumer', 'unrelated', 'middle', 'base'),
    ),
    {
      order: ['base', 'middle', 'consumer', 'unrelated'],
      blocked: new Map(),
    },
  )
})

test('resolver uses states without inferring defaults or loading unknown ids', () => {
  const manifests = [addon('markdown'), addon('consumer', 'markdown')]
  assert.deepEqual(resolveAddonDependencies(manifests, []), {
    order: [],
    blocked: new Map(),
  })
  assert.deepEqual(
    resolveAddonDependencies(manifests, [
      ...enabled('consumer', 'unknown'),
      { id: 'markdown', enabled: false },
    ]),
    {
      order: [],
      blocked: new Map([['consumer', ['markdown']]]),
    },
  )
})

test('missing requirements block even with stale enabled states', () => {
  const manifests = [addon('consumer', 'missing'), addon('healthy')]
  assert.deepEqual(
    resolveAddonDependencies(
      manifests,
      enabled('consumer', 'missing', 'healthy'),
    ),
    {
      order: ['healthy'],
      blocked: new Map([['consumer', ['missing']]]),
    },
  )
})

test('disabled requirements block consumers', () => {
  const manifests = [addon('consumer', 'disabled'), addon('disabled')]
  assert.deepEqual(
    resolveAddonDependencies(manifests, [
      ...enabled('consumer'),
      { id: 'disabled', enabled: false },
    ]),
    {
      order: [],
      blocked: new Map([['consumer', ['disabled']]]),
    },
  )
})

test('root blockers propagate through required diamonds and deduplicate', () => {
  const manifests = [
    addon('top', 'left', 'right', 'disabled'),
    addon('left', 'missing', 'disabled'),
    addon('right', 'missing'),
    addon('disabled'),
  ]
  assert.deepEqual(
    resolveAddonDependencies(manifests, enabled('top', 'left', 'right')),
    {
      order: [],
      blocked: new Map([
        ['left', ['missing', 'disabled']],
        ['right', ['missing']],
        ['top', ['missing', 'disabled']],
      ]),
    },
  )
})

test('disabled direct blockers remain direct instead of exposing their requirements', () => {
  const manifests = [
    addon('consumer', 'disabled'),
    addon('disabled', 'missing'),
  ]
  assert.deepEqual(
    resolveAddonDependencies(manifests, enabled('consumer')).blocked,
    new Map([['consumer', ['disabled']]]),
  )
})

test('missing and disabled optional dependencies never block', () => {
  const manifests = [
    addon(
      'consumer',
      { id: 'missing', optional: true },
      { id: 'disabled', optional: true },
    ),
    addon('disabled'),
  ]
  assert.deepEqual(resolveAddonDependencies(manifests, enabled('consumer')), {
    order: ['consumer'],
    blocked: new Map(),
  })
})

test('enabled optional dependencies load before consumers', () => {
  const manifests = [
    addon('consumer', { id: 'optional', optional: true }),
    addon('optional', 'base'),
    addon('base'),
  ]
  assert.deepEqual(
    resolveAddonDependencies(
      manifests,
      enabled('consumer', 'optional', 'base'),
    ),
    {
      order: ['base', 'optional', 'consumer'],
      blocked: new Map(),
    },
  )
})

test('blocked optional dependencies do not block consumers or load', () => {
  const manifests = [
    addon('consumer', { id: 'optional', optional: true }),
    addon('optional', 'missing'),
  ]
  assert.deepEqual(
    resolveAddonDependencies(manifests, enabled('consumer', 'optional')),
    {
      order: ['consumer'],
      blocked: new Map([['optional', ['missing']]]),
    },
  )
})

test('graph validation rejects unknown required ids unless missing is allowed', () => {
  const manifests = [addon('consumer', 'missing')]
  assert.throws(
    () => validateAddonRequirements(manifests),
    /consumer.*requires unknown addon "missing"/,
  )
  assert.doesNotThrow(() =>
    validateAddonRequirements(manifests, { allowMissing: true }),
  )
  assert.throws(
    () => validateAddonRequirements(manifests, { allowMissing: false }),
    /unknown addon/,
  )
  assert.doesNotThrow(() =>
    validateAddonRequirements([
      addon('consumer', { id: 'missing', optional: true }),
    ]),
  )
})

test('validation applies parser rules and rejects duplicate manifest identities', () => {
  assert.throws(
    () => validateAddonRequirements([addon('owner', 'owner')]),
    /cannot require itself/,
  )
  assert.throws(
    () =>
      validateAddonRequirements([
        { id: 'owner', requires: { addons: [{ id: 'Bad' }] } },
      ]),
    /dependency id must match/,
  )
  assert.throws(
    () => validateAddonRequirements([addon('same'), addon('same')]),
    /Duplicate addon id "same"/,
  )
})

test('cycles report exact loop path without unrelated prefix', () => {
  const manifests = [
    addon('entry', 'alpha'),
    addon('alpha', 'beta'),
    addon('beta', 'gamma'),
    addon('gamma', 'alpha'),
  ]
  for (const run of [
    () => validateAddonRequirements(manifests),
    () =>
      resolveAddonDependencies(
        manifests,
        enabled('entry', 'alpha', 'beta', 'gamma'),
      ),
    () => requiredAddonDependencies(manifests, 'entry'),
    () => addonDependents(manifests, 'alpha'),
  ])
    assert.throws(
      run,
      /Addon dependency cycle: alpha -> beta -> gamma -> alpha\./,
    )
})

test('present optional edges participate in cycle validation even when disabled', () => {
  for (const manifests of [
    [addon('alpha', { id: 'beta', optional: true }), addon('beta', 'alpha')],
    [
      addon('alpha', { id: 'beta', optional: true }),
      addon('beta', { id: 'alpha', optional: true }),
    ],
  ]) {
    assert.throws(
      () => validateAddonRequirements(manifests),
      /alpha -> beta -> alpha/,
    )
    assert.throws(
      () => validateAddonRequirements(manifests, { allowMissing: true }),
      /alpha -> beta -> alpha/,
    )
    assert.throws(
      () => resolveAddonDependencies(manifests, []),
      /alpha -> beta -> alpha/,
    )
  }
})

test('required closure is topological and excludes optional edges and their subtrees', () => {
  const manifests = [
    addon('top', 'left', 'right', { id: 'optional', optional: true }),
    addon('left', 'base'),
    addon('right', 'base'),
    addon('base'),
    addon('optional', 'optional-root'),
    addon('optional-root'),
  ]
  assert.deepEqual(requiredAddonDependencies(manifests, 'top'), [
    'base',
    'left',
    'right',
  ])
  assert.deepEqual(requiredAddonDependencies(manifests, 'base'), [])
  assert.deepEqual(requiredAddonDependencies(manifests, 'unknown'), [])
})

test('required closure includes missing ids once in load order', () => {
  const manifests = [
    addon('top', 'middle', 'missing'),
    addon('middle', 'missing'),
  ]
  assert.deepEqual(requiredAddonDependencies(manifests, 'top'), [
    'missing',
    'middle',
  ])
})

test('required dependency map preserves each closure order, missing ids and optional exclusion', () => {
  const manifests = [
    addon('top', 'left', 'right', { id: 'optional', optional: true }),
    addon('left', 'base', 'missing'),
    addon('right', 'base', 'missing'),
    addon('base'),
    addon('optional', 'optional-root'),
  ]
  const dependencies = requiredAddonDependencyMap(manifests)
  assert.deepEqual(
    dependencies,
    new Map([
      ['top', ['base', 'missing', 'left', 'right']],
      ['left', ['base', 'missing']],
      ['right', ['base', 'missing']],
      ['base', []],
      ['optional', ['optional-root']],
    ]),
  )
  for (const { id } of manifests)
    assert.deepEqual(
      dependencies.get(id),
      requiredAddonDependencies(manifests, id),
    )
  assert.deepEqual(requiredAddonDependencyMap([]), new Map())
  assert.throws(
    () =>
      requiredAddonDependencyMap([
        addon('alpha', 'beta'),
        addon('beta', 'alpha'),
      ]),
    /alpha -> beta -> alpha/,
  )
  assert.throws(
    () => requiredAddonDependencyMap([addon('owner', 'owner')]),
    /cannot require itself/,
  )
})

test('required dependents are transitive in unload order and exclude optional consumers', () => {
  const manifests = [
    addon('top', 'left', 'right'),
    addon('left', 'base'),
    addon('right', 'base'),
    addon('base'),
    addon('optional', { id: 'base', optional: true }),
    addon('optional-child', 'optional'),
  ]
  assert.deepEqual(addonDependents(manifests, 'base'), ['top', 'right', 'left'])
  assert.deepEqual(addonDependents(manifests, 'top'), [])
  assert.deepEqual(addonDependents(manifests, 'unknown'), [])
})

test('required dependents retain consumers of missing manifests', () => {
  const manifests = [addon('top', 'middle'), addon('middle', 'missing')]
  assert.deepEqual(addonDependents(manifests, 'missing'), ['top', 'middle'])
})

test('empty graphs work and graph helpers preserve frozen inputs', () => {
  assert.doesNotThrow(() => validateAddonRequirements([]))
  assert.deepEqual(resolveAddonDependencies([], []), {
    order: [],
    blocked: new Map(),
  })
  const manifests = Object.freeze([
    Object.freeze({
      id: 'consumer',
      name: 'Consumer',
      requires: Object.freeze({
        addons: Object.freeze([Object.freeze({ id: 'base' })]),
      }),
    }),
    Object.freeze({ id: 'base' }),
  ])
  const states = Object.freeze(enabled('consumer', 'base').map(Object.freeze))
  assert.deepEqual(resolveAddonDependencies(manifests, states).order, [
    'base',
    'consumer',
  ])
  assert.deepEqual(requiredAddonDependencies(manifests, 'consumer'), ['base'])
  assert.deepEqual(addonDependents(manifests, 'base'), ['consumer'])
  assert.doesNotThrow(() => validateAddonRequirements(manifests))
})

test('editor windows find background addons among transitive requirements', () => {
  const manifests = [
    addon('editor', 'helper'),
    addon('helper', 'service'),
    { ...addon('service'), startup: 'background' },
    { ...addon('palette'), activation: 'command' },
    addon('syntax', 'palette'),
  ]
  const dependencies = requiredAddonDependencyMap(manifests)
  assert.deepEqual(
    backgroundAddonDependencies(manifests, dependencies.get('editor')),
    ['service'],
  )
  assert.deepEqual(
    backgroundAddonDependencies(manifests, dependencies.get('syntax')),
    ['palette'],
  )
  assert.deepEqual(
    backgroundAddonDependencies(manifests, dependencies.get('service')),
    [],
  )
})
