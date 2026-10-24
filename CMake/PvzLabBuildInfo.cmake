# @ShadyLeeGamer: writes the commit and the current time into a header on every build,
# so the main menu can show exactly which build is running.
# Usage: cmake -DOUT=<header path> -DSRC=<source dir> -P PvzLabBuildInfo.cmake
string(TIMESTAMP PVZLAB_BUILD_TIME "%d %b %Y %H:%M")

set(PVZLAB_COMMIT "unknown")
find_package(Git QUIET)
if(GIT_FOUND)
	execute_process(COMMAND "${GIT_EXECUTABLE}" rev-parse --short HEAD
		WORKING_DIRECTORY "${SRC}" RESULT_VARIABLE _rc
		OUTPUT_VARIABLE _hash OUTPUT_STRIP_TRAILING_WHITESPACE ERROR_QUIET)
	if(_rc EQUAL 0 AND _hash)
		set(PVZLAB_COMMIT "${_hash}")
		# "-dirty" = built with uncommitted changes to tracked files
		execute_process(COMMAND "${GIT_EXECUTABLE}" status --porcelain --untracked-files=no
			WORKING_DIRECTORY "${SRC}"
			OUTPUT_VARIABLE _changes OUTPUT_STRIP_TRAILING_WHITESPACE ERROR_QUIET)
		if(_changes)
			string(APPEND PVZLAB_COMMIT "-dirty")
		endif()
	endif()
endif()

file(WRITE "${OUT}" "#pragma once\n#define PVZLAB_BUILD_TIME \"${PVZLAB_BUILD_TIME}\"\n#define PVZLAB_COMMIT \"${PVZLAB_COMMIT}\"\n")
