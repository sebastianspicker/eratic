.PHONY: web-dev web-check core-test apple-project apple-build check

web-dev:
	npm --prefix apps/web run dev

web-check:
	npm --prefix apps/web test
	npm --prefix apps/web run build

core-test:
	swift test --package-path apps/apple/EraticCore

apple-project:
	xcodegen generate --spec apps/apple/project.yml

apple-build: apple-project
	xcodebuild -project apps/apple/Eratic.xcodeproj -scheme Eratic-macOS -destination 'platform=macOS' -derivedDataPath .cache/apple-macos CODE_SIGNING_ALLOWED=NO build
	xcodebuild -project apps/apple/Eratic.xcodeproj -scheme Eratic-iOS -destination 'generic/platform=iOS Simulator' -derivedDataPath .cache/apple-ios CODE_SIGNING_ALLOWED=NO build

check: web-check core-test

