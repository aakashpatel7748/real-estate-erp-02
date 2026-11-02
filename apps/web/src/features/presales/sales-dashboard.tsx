import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarClock, FileText, Footprints, IndianRupee, Target, TrendingUp } from 'lucide-react';
import { todayInIndia } from '@erp/shared';
import { api } from '@/lib/api';
import { formatINR, formatINRCompact } from '@/lib/format';
import { useProjectContext } from '@/hooks/use-project';
import { Card, CardContent, CardHeader, CardTitle, Input, Label } from '@/components/ui/primitives';
import { PageHeader, StatCard } from '@/components/common';
import { ErrorState, PageSkeleton } from '@/components/states';

interface SalesDashboard {
  from: string;
  to: string;
  kpis: {
    leads: number;
    won: number;
    conversionBp: number;
    siteVisits: number;
    bookings: number;
    bookingValuePaise: number;
    cancellations: number;
    quotations: number;
    quotationValuePaise: number;
    quotationsConverted: number;
    followUpsOverdue: number;
    followUpsToday: number;
  };
  bySource: { source: string; label: string; leads: number; won: number }[];
  pipeline: { status: string; label: string; leads: number }[];
  trend: { week: string; leads: number; bookings: number; valuePaise: number }[];
  executives: { userId: string | null; name: string; leads: number; open: number; won: number; bookings: number; valuePaise: number }[];
}

const monthStart = (d: string) => `${d.slice(0, 7)}-01`;

export function SalesDashboardPage() {
  const { projectId, project } = useProjectContext();
  const today = todayInIndia();
  const [from, setFrom] = React.useState(monthStart(today));
  const [to, setTo] = React.useState(today);
  const q = useQuery({
    queryKey: ['sales-dashboard', projectId, from, to],
    queryFn: () => api.get<SalesDashboard>('/sales-dashboard', { projectId: projectId ?? undefined, from, to }),
  });
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const k = d.kpis;
  const maxStage = Math.max(1, ...d.pipeline.map((p) => p.leads));
  return (
    <>
      <PageHeader
        title="Sales Dashboard"
        description={`${project?.name ?? 'All projects'} · enquiries, conversions and bookings`}
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="sd-from" className="text-xs">
                From
              </Label>
              <Input id="sd-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label htmlFor="sd-to" className="text-xs">
                To
              </Label>
              <Input id="sd-to" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="h-9" />
            </div>
          </div>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="New enquiries"
          value={k.leads}
          hint={`${k.won} won · ${(k.conversionBp / 100).toFixed(1)}% conversion`}
          icon={Target}
        />
        <StatCard label="Site visits" value={k.siteVisits} icon={Footprints} />
        <StatCard
          label="Bookings"
          value={k.bookings}
          hint={`${formatINRCompact(k.bookingValuePaise)}${k.cancellations ? ` · ${k.cancellations} cancelled` : ''}`}
          icon={IndianRupee}
          tone="success"
        />
        <StatCard
          label="Follow-ups due"
          value={k.followUpsOverdue + k.followUpsToday}
          hint={
            <Link to="/pre-sales/leads?followUp=due" className="hover:underline">
              {k.followUpsOverdue} overdue · {k.followUpsToday} today
            </Link>
          }
          icon={CalendarClock}
          tone={k.followUpsOverdue ? 'danger' : 'default'}
        />
      </div>
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="size-4 text-muted-foreground" /> Weekly enquiries vs bookings
            </CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {d.trend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={d.trend} margin={{ left: -16, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="week" tickFormatter={(w: string) => w.slice(5)} fontSize={11} />
                  <YAxis allowDecimals={false} fontSize={11} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="leads" name="Enquiries" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="bookings" name="Bookings" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground">No activity in the last 12 weeks.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Open pipeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {d.pipeline.map((p) => (
              <Link key={p.status} to={`/pre-sales/leads?status=${p.status}`} className="block rounded-md hover:bg-muted/50">
                <div className="mb-1 flex justify-between text-sm">
                  <span>{p.label}</span>
                  <span className="font-medium tabular">{p.leads}</span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${(p.leads / maxStage) * 100}%` }} />
                </div>
              </Link>
            ))}
            <div className="border-t pt-3 text-sm text-muted-foreground">
              <FileText className="mr-1 inline size-4" /> {k.quotations} {k.quotations === 1 ? 'quotation' : 'quotations'} (
              {formatINRCompact(k.quotationValuePaise)}) · {k.quotationsConverted} converted
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Enquiries by source</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {d.bySource.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.bySource} layout="vertical" margin={{ left: 24, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                  <XAxis type="number" allowDecimals={false} fontSize={11} />
                  <YAxis type="category" dataKey="label" width={90} fontSize={11} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="leads" name="Enquiries" fill="var(--chart-1)" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="won" name="Won" fill="var(--chart-2)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground">No enquiries in this period.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Sales team</CardTitle>
          </CardHeader>
          <CardContent>
            {!d.executives.length ? (
              <p className="text-sm text-muted-foreground">No activity in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-2 font-medium">Executive</th>
                      <th className="py-2 text-right font-medium">Enquiries</th>
                      <th className="py-2 text-right font-medium">Open</th>
                      <th className="py-2 text-right font-medium">Won</th>
                      <th className="py-2 text-right font-medium">Bookings</th>
                      <th className="py-2 text-right font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {d.executives.map((e) => (
                      <tr key={e.userId ?? 'none'}>
                        <td className="py-2 font-medium">{e.name}</td>
                        <td className="py-2 text-right tabular">{e.leads}</td>
                        <td className="py-2 text-right tabular">{e.open}</td>
                        <td className="py-2 text-right tabular">{e.won}</td>
                        <td className="py-2 text-right tabular">{e.bookings}</td>
                        <td className="py-2 text-right tabular">{formatINR(e.valuePaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
