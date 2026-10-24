import { titleOf } from '../../features/anime/format.ts'
import { axisRaw, AXIS_KEYS, contributions, scoresOf, type Ranked, type Scale } from './score.ts'
import type { LabTitle } from './titles.ts'
import { AXIS_LABELS } from './words.ts'

const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}`

/**
 * The lab's debug view (not a part of the page): the top 10's three scores, raw and on the
 * sliders' scale, and their distance; with the spoiler check, every mapped tag each one has, where
 * a spoiler tag shows that it counts but is never named.
 */
export function Debug({
  ranked,
  scale,
  scores,
  spoilers,
}: {
  ranked: Ranked<LabTitle>[]
  scale: Scale
  scores: boolean
  spoilers: boolean
}) {
  const top = ranked.slice(0, 10)
  return (
    <section className="ab-lab-box" aria-label="Lab: scores">
      <h2 className="ab-lab-legend">
        <span className="ab-lab-tag">Lab</span> The top 10’s scores
      </h2>
      <p className="ab-lab-why">
        Each axis: the raw score (a genre 1.0, a tag rank / 100), then{' '}
        {scale === 'tanh' ? 'squashed, 2 × tanh(raw / 1.5)' : 'cut off at ±2 (A6 b)'}.
        {spoilers && ' Spoiler tags (red) count toward a score, and are never named.'}
      </p>
      {scores && (
        <div className="ab-lab-table-box">
          <table className="ab-lab-table">
            <thead>
              <tr>
                <th scope="col">Title</th>
                {AXIS_LABELS.map((label) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
                <th scope="col">Distance</th>
              </tr>
            </thead>
            <tbody>
              {top.map(({ media, distance }) => {
                const on = scoresOf(media, scale)
                return (
                  <tr key={media.id}>
                    <th scope="row">{titleOf(media)}</th>
                    {AXIS_KEYS.map((axis) => (
                      <td key={axis}>
                        {signed(axisRaw(media, axis))} → <b>{signed(on[axis])}</b>
                      </td>
                    ))}
                    <td>{distance.toFixed(2)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {spoilers && (
        <ul className="ab-lab-tags">
          {top.map(({ media }) => (
            <li key={media.id}>
              <b>{titleOf(media)}:</b>{' '}
              {contributions(media).map(({ axis, name, weight, spoiler }, i) => (
                <span
                  key={`${axis}-${name}-${i}`}
                  className={spoiler ? 'ab-lab-tag-spoiler' : 'ab-lab-tag-plain'}
                >
                  {name} ({axis}, {signed(weight)}){spoiler ? ', spoiler: counts, never named' : ''}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
