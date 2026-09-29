-- The espresso plug is shown by its machine, not its plug brand.
update consumption.devices
set name = 'Lelit Bianca'
where source = 'tuya'
  and metadata ->> 'device_role' = 'espresso_machine';
