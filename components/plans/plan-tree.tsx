"use client";

import { useState } from "react";
import type { PlanNode } from "@/lib/demo/types";

function Node({
  node,
  selected,
  onSelect,
}: {
  node: PlanNode;
  selected: string;
  onSelect: (node: PlanNode) => void;
}) {
  return (
    <div className="plan-node-wrap">
      <button
        type="button"
        className={`plan-node severity-${node.tone}${selected === node.id ? " selected" : ""}`}
        onClick={() => onSelect(node)}
      >
        <span className="severity-mark" />
        <span style={{ textAlign: "left" }}>
          <span className="plan-node-title">
            {node.name}
            {node.relation ? (
              <span className="plan-node-relation">{node.relation}</span>
            ) : null}
          </span>
          <span className="plan-node-detail">{node.detail}</span>
        </span>
        <span className="plan-node-stats">
          <span>{node.time.toFixed(node.time < 1 ? 3 : 1)}ms</span>
          <span>{node.rows.toLocaleString()} rows</span>
          <span>{node.loops.toLocaleString()}×</span>
        </span>
      </button>
      {node.children?.length ? (
        <div className="plan-children">
          {node.children.map((child) => (
            <Node
              node={child}
              selected={selected}
              onSelect={onSelect}
              key={child.id}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PlanTree({ root }: { root: PlanNode }) {
  const [selected, setSelected] = useState(root);
  return (
    <>
      <div className="plan-tree">
        <Node node={root} selected={selected.id} onSelect={setSelected} />
      </div>
      <div className="plan-inspector" aria-label="Selected plan node details">
        <div className="inspector-stat">
          <span>Actual time</span>
          <strong>{selected.time.toFixed(2)} ms</strong>
        </div>
        <div className="inspector-stat">
          <span>Planner cost</span>
          <strong>{selected.cost.toFixed(1)}%</strong>
        </div>
        <div className="inspector-stat">
          <span>Actual rows</span>
          <strong>{selected.rows.toLocaleString()}</strong>
        </div>
        <div className="inspector-stat">
          <span>Estimate error</span>
          <strong>
            {(selected.rows / Math.max(selected.estimate, 1)).toFixed(1)}×
          </strong>
        </div>
      </div>
    </>
  );
}
