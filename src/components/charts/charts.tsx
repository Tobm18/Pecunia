"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCents, formatCentsCompact } from "@/lib/domain/money";
import { Segmented } from "@/components/ui/primitives";

const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--divider)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--text)",
};

/** Anneau de répartition des dépenses avec total au centre. */
export function DonutChart({
  data,
  totalCents,
}: {
  data: { name: string; cents: number; color: string }[];
  totalCents: number;
}) {
  return (
    <div className="relative size-40 shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="cents"
            nameKey="name"
            innerRadius="62%"
            outerRadius="100%"
            paddingAngle={1.5}
            stroke="none"
            isAnimationActive={false}
          >
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatCents(Number(v))} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[11px] text-n-600">Sorties</span>
        <span className="text-lg font-extrabold tabular-nums">{formatCentsCompact(totalCents)}</span>
      </div>
    </div>
  );
}

/** Histogramme des dépenses mensuelles, bascule 6 / 12 mois ; le dernier mois est accentué. */
export function MonthlyBars({ data }: { data: { label: string; cents: number }[] }) {
  const [depth, setDepth] = useState<"6" | "12">("12");
  const shown = data.slice(-Number(depth));
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <Segmented
          size="sm"
          value={depth}
          onChange={setDepth}
          options={[
            { value: "6", label: "6 mois" },
            { value: "12", label: "12 mois" },
          ]}
        />
      </div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={shown} margin={{ top: 18, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--n-600)" }} />
            <YAxis hide />
            <Tooltip
              cursor={{ fill: "var(--n-100)" }}
              contentStyle={tooltipStyle}
              formatter={(v) => [formatCents(Number(v)), "Dépenses"]}
            />
            <Bar dataKey="cents" radius={[6, 6, 0, 0]} isAnimationActive={false}>
              {shown.map((d, i) => (
                <Cell key={d.label + i} fill={i === shown.length - 1 ? "var(--accent)" : "var(--accent-200)"} />
              ))}
              <LabelList
                dataKey="cents"
                position="top"
                formatter={(v) => (Number(v) > 0 ? `${(Number(v) / 100000).toFixed(1).replace(".", ",")}k` : "")}
                style={{ fontSize: 10, fill: "var(--n-600)" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Courbe d'évolution (patrimoine, solde d'un compte). */
export function BalanceArea({
  data,
  color = "var(--accent)",
  height = 160,
}: {
  data: { label: string; cents: number }[];
  color?: string;
  height?: number;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--n-600)" }} />
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => [formatCents(Number(v)), "Solde"]} />
          <Area
            type="linear"
            dataKey="cents"
            stroke={color}
            strokeWidth={2}
            fill={color}
            fillOpacity={0.1}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
