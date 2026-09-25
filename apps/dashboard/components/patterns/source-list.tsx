import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { latestTimestampForDevice, sourceKind } from "@/lib/consumption"
import type { DeviceRow, ReadingRow } from "@/lib/supabase/database.types"

export function SourceList({
  devices,
  readings,
}: {
  devices: DeviceRow[]
  readings: ReadingRow[]
}) {
  if (devices.length === 0) {
    return <p className="type-body text-muted-foreground">No devices connected yet.</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Source</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead>Identifier</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {devices.map((device) => {
          const live = Boolean(latestTimestampForDevice(device, readings))
          return (
            <TableRow key={device.id}>
              <TableCell>
                <div className="font-medium">{device.name}</div>
                <div className="type-caption">{device.source}</div>
              </TableCell>
              <TableCell>{sourceKind(device)}</TableCell>
              <TableCell className="font-mono text-xs">{device.external_id}</TableCell>
              <TableCell className={live ? "text-foreground" : "text-muted-foreground"}>
                {live ? "Live" : "Quiet"}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
