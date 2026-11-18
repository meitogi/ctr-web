"""Region from SYSTEM.CNF : the boot executable names the release."""

import re

REGIONS = {
	"SCUS_944.26": "us",
	"SCES_021.05": "pal",
}

_BOOT = re.compile(rb"BOOT\s*=\s*cdrom:\\?([A-Za-z0-9_.]+)(?:;1)?", re.I)


def boot_exe(system_cnf):
	m = _BOOT.search(system_cnf)
	if not m:
		raise ValueError("SYSTEM.CNF has no BOOT line")
	return m.group(1).decode("ascii").upper()


def region_of(system_cnf):
	"""(boot executable, region) ; region is None for a release this tool does not know."""
	exe = boot_exe(system_cnf)
	return exe, REGIONS.get(exe)
