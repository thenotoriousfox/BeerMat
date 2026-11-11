"""Writes BeerMat.xcodeproj/project.pbxproj: one iOS app target compiling the SwiftUI app (BeerMat/) and BeerMatKit's
sources, with its resources. Run it after adding or removing a file:  python3 native/ios/make-project.py"""
import hashlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = sorted(p.name for p in (HERE / 'BeerMat').glob('*.swift'))
KIT = sorted(p.name for p in (HERE / 'BeerMatKit/Sources/BeerMatKit').glob('*.swift'))
RESOURCES = ['Assets.xcassets', 'Fredoka.ttf', 'Fredoka-OFL.txt', 'badges.json', 'i18n.json']


def oid(name):
    return hashlib.md5(name.encode()).hexdigest()[:24].upper()


def kind(name):
    return {'swift': 'sourcecode.swift', 'xcassets': 'folder.assetcatalog', 'ttf': 'file', 'txt': 'text', 'json': 'text.json', 'plist': 'text.plist.xml'}[name.rsplit('.', 1)[1]]


files = [(f'BeerMat/{n}', n, 'app') for n in APP] + [(f'BeerMatKit/Sources/BeerMatKit/{n}', n, 'kit') for n in KIT] + [(f'BeerMat/{n}', n, 'res') for n in RESOURCES]
out = ['// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {\n\t};\n\tobjectVersion = 56;\n\tobjects = {\n', '\n/* Begin PBXBuildFile section */\n']
for path, name, k in files:
    out.append(f'\t\t{oid("build:" + path)} /* {name} in {"Resources" if k == "res" else "Sources"} */ = {{isa = PBXBuildFile; fileRef = {oid("ref:" + path)} /* {name} */; }};\n')
out.append('/* End PBXBuildFile section */\n\n/* Begin PBXFileReference section */\n')
out.append(f'\t\t{oid("product")} /* BeerMat.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = BeerMat.app; sourceTree = BUILT_PRODUCTS_DIR; }};\n')
out.append(f'\t\t{oid("ref:BeerMat/Info.plist")} /* Info.plist */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; }};\n')
for path, name, k in files:
    out.append(f'\t\t{oid("ref:" + path)} /* {name} */ = {{isa = PBXFileReference; lastKnownFileType = {kind(name)}; path = {name}; sourceTree = "<group>"; }};\n')
out.append('/* End PBXFileReference section */\n\n/* Begin PBXFrameworksBuildPhase section */\n')
out.append(f'\t\t{oid("frameworks")} /* Frameworks */ = {{\n\t\t\tisa = PBXFrameworksBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t}};\n')
out.append('/* End PBXFrameworksBuildPhase section */\n\n/* Begin PBXGroup section */\n')


def group(key, name, children, path=None):
    kids = ''.join(f'\t\t\t\t{c} /* {n} */,\n' for c, n in children)
    where = f'\n\t\t\tpath = {path};' if path else f'\n\t\t\tname = {name};'
    return f'\t\t{oid(key)} /* {name} */ = {{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n{kids}\t\t\t);{where}\n\t\t\tsourceTree = "<group>";\n\t\t}};\n'


out.append(group('main', 'Main', [(oid('group:app'), 'BeerMat'), (oid('group:kit'), 'BeerMatKit'), (oid('group:products'), 'Products')]))
out.append(group('group:app', 'BeerMat', [(oid('ref:' + p), n) for p, n, k in files if k in ('app', 'res')] + [(oid('ref:BeerMat/Info.plist'), 'Info.plist')], 'BeerMat'))
out.append(group('group:kit', 'BeerMatKit', [(oid('ref:' + p), n) for p, n, k in files if k == 'kit'], 'BeerMatKit/Sources/BeerMatKit'))
out.append(group('group:products', 'Products', [(oid('product'), 'BeerMat.app')]))
out.append('/* End PBXGroup section */\n\n/* Begin PBXNativeTarget section */\n')
out.append(f'''\t\t{oid("target")} /* BeerMat */ = {{
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = {oid("configs:target")} /* Build configuration list for PBXNativeTarget "BeerMat" */;
\t\t\tbuildPhases = (
\t\t\t\t{oid("sources")} /* Sources */,
\t\t\t\t{oid("frameworks")} /* Frameworks */,
\t\t\t\t{oid("resources")} /* Resources */,
\t\t\t);
\t\t\tbuildRules = (
\t\t\t);
\t\t\tdependencies = (
\t\t\t);
\t\t\tname = BeerMat;
\t\t\tproductName = BeerMat;
\t\t\tproductReference = {oid("product")} /* BeerMat.app */;
\t\t\tproductType = "com.apple.product-type.application";
\t\t}};
/* End PBXNativeTarget section */

/* Begin PBXProject section */
\t\t{oid("project")} /* Project object */ = {{
\t\t\tisa = PBXProject;
\t\t\tattributes = {{
\t\t\t\tBuildIndependentTargetsInParallel = 1;
\t\t\t\tLastSwiftUpdateCheck = 1500;
\t\t\t\tLastUpgradeCheck = 1500;
\t\t\t}};
\t\t\tbuildConfigurationList = {oid("configs:project")} /* Build configuration list for PBXProject "BeerMat" */;
\t\t\tcompatibilityVersion = "Xcode 14.0";
\t\t\tdevelopmentRegion = en;
\t\t\thasScannedForEncodings = 0;
\t\t\tknownRegions = (
\t\t\t\ten,
\t\t\t\tBase,
\t\t\t);
\t\t\tmainGroup = {oid("main")};
\t\t\tproductRefGroup = {oid("group:products")} /* Products */;
\t\t\tprojectDirPath = "";
\t\t\tprojectRoot = "";
\t\t\ttargets = (
\t\t\t\t{oid("target")} /* BeerMat */,
\t\t\t);
\t\t}};
/* End PBXProject section */

/* Begin PBXResourcesBuildPhase section */
\t\t{oid("resources")} /* Resources */ = {{
\t\t\tisa = PBXResourcesBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
''')
out += [f'\t\t\t\t{oid("build:" + p)} /* {n} in Resources */,\n' for p, n, k in files if k == 'res']
out.append(f'''\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t}};
/* End PBXResourcesBuildPhase section */

/* Begin PBXSourcesBuildPhase section */
\t\t{oid("sources")} /* Sources */ = {{
\t\t\tisa = PBXSourcesBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
''')
out += [f'\t\t\t\t{oid("build:" + p)} /* {n} in Sources */,\n' for p, n, k in files if k != 'res']
out.append('\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};\n/* End PBXSourcesBuildPhase section */\n\n/* Begin XCBuildConfiguration section */\n')
common = ('\t\t\t\tALWAYS_SEARCH_USER_PATHS = NO;\n\t\t\t\tCLANG_ENABLE_MODULES = YES;\n\t\t\t\tCLANG_ENABLE_OBJC_ARC = YES;\n\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 16.0;\n'
          '\t\t\t\tSDKROOT = iphoneos;\n\t\t\t\tSWIFT_VERSION = 5.0;\n\t\t\t\tENABLE_USER_SCRIPT_SANDBOXING = YES;\n')
for cfg in ['Debug', 'Release']:
    extra = ('\t\t\t\tDEBUG_INFORMATION_FORMAT = dwarf;\n\t\t\t\tONLY_ACTIVE_ARCH = YES;\n\t\t\t\tSWIFT_OPTIMIZATION_LEVEL = "-Onone";\n\t\t\t\tSWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;\n\t\t\t\tENABLE_TESTABILITY = YES;\n'
             if cfg == 'Debug' else '\t\t\t\tDEBUG_INFORMATION_FORMAT = "dwarf-with-dsym";\n\t\t\t\tSWIFT_COMPILATION_MODE = wholemodule;\n\t\t\t\tVALIDATE_PRODUCT = YES;\n')
    out.append(f'\t\t{oid("project:" + cfg)} /* {cfg} */ = {{\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = {{\n{common}{extra}\t\t\t}};\n\t\t\tname = {cfg};\n\t\t}};\n')
    bundle = 'uk.beermat.app.next' if cfg == 'Debug' else 'uk.beermat.app'
    out.append(f'''\t\t{oid("target:" + cfg)} /* {cfg} */ = {{
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {{
\t\t\t\tASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
\t\t\t\tCODE_SIGN_STYLE = Automatic;
\t\t\t\tCURRENT_PROJECT_VERSION = 630;
\t\t\t\tDEVELOPMENT_TEAM = "";
\t\t\t\tGENERATE_INFOPLIST_FILE = NO;
\t\t\t\tINFOPLIST_FILE = BeerMat/Info.plist;
\t\t\t\tLD_RUNPATH_SEARCH_PATHS = (
\t\t\t\t\t"$(inherited)",
\t\t\t\t\t"@executable_path/Frameworks",
\t\t\t\t);
\t\t\t\tMARKETING_VERSION = 0.7.16;
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = {bundle};
\t\t\t\tPRODUCT_NAME = BeerMat;
\t\t\t\tSWIFT_EMIT_LOC_STRINGS = YES;
\t\t\t\tTARGETED_DEVICE_FAMILY = 1;
\t\t\t}};
\t\t\tname = {cfg};
\t\t}};
''')
out.append('/* End XCBuildConfiguration section */\n\n/* Begin XCConfigurationList section */\n')
for key, label in [('project', 'PBXProject "BeerMat"'), ('target', 'PBXNativeTarget "BeerMat"')]:
    out.append(f'\t\t{oid("configs:" + key)} /* Build configuration list for {label} */ = {{\n\t\t\tisa = XCConfigurationList;\n\t\t\tbuildConfigurations = (\n'
               f'\t\t\t\t{oid(key + ":Debug")} /* Debug */,\n\t\t\t\t{oid(key + ":Release")} /* Release */,\n\t\t\t);\n\t\t\tdefaultConfigurationIsVisible = 0;\n\t\t\tdefaultConfigurationName = Release;\n\t\t}};\n')
out.append('/* End XCConfigurationList section */\n\t};\n\trootObject = ' + oid('project') + ' /* Project object */;\n}\n')
(HERE / 'BeerMat.xcodeproj' / 'project.pbxproj').write_text(''.join(out))
print(f'{len(APP)} app files, {len(KIT)} kit files, {len(RESOURCES)} resources')
