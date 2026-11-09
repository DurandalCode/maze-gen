import type {FileStore} from '../../server/store';
type Walks=Awaited<ReturnType<FileStore['listWalks']>>;
type Mazes=Awaited<ReturnType<FileStore['listMazes']>>;
export function WalkComparison({walks,mazes}:{walks:Walks;mazes:Mazes}) {
  if(walks.length<2)return null;
  return <section aria-label="Сравнение первых прохождений"><h4>Сравнение первых прохождений</h4>
    <p>Первые записанные попытки, завершённые выходом. Разведка и повторы посчитаны отдельно; дополнительные метрики доступны для деревьев проходов.</p>
    <div className="walk-comparison"><table><thead><tr><th>Лабиринт</th><th>Боковая площадь</th><th>Первый уход вбок</th><th>Веток ≥6 м</th><th>Типичная глубина</th><th>Разведка / кратчайший</th><th>Обязательная площадь</th><th>Повторы</th></tr></thead>
    <tbody>{walks.map(row=>{const e=row.assessment.exploration!;return <tr key={row.id}>
      <th>{mazes.find(m=>m.id===row.mazeId)?.title??`${row.columns} × ${row.rows}`}</th>
      <td>{(e.exploredOptionalRatio*100).toFixed(0)}%</td><td>{e.firstDetourChoices}/{e.assessedFirstChoices}</td><td>{e.deepBranches}</td>
      <td>{e.medianBranchDepth.toFixed(1)} м</td><td>{(e.uniqueExplorationRatio*100).toFixed(0)}%</td><td>{(e.mandatoryAreaRatio*100).toFixed(0)}%</td><td>{e.repeatedLength.toFixed(0)} м</td>
    </tr>;})}</tbody></table></div>
  </section>;
}
