'''
Imagine Launcher 
'''
import os
import shutil
import json
import zipfile
import posixpath
import subprocess
import logging 
import colorlog
# Logger
def setup_logging():
    logger = logging.getLogger()
    logger.setLevel(logging.DEBUG)  # Debug Mode

    handler = colorlog.StreamHandler()

    formatter = colorlog.ColoredFormatter(
        '%(log_color)s%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        log_colors={
            'DEBUG': 'cyan',
            'INFO': 'lightgreen',
            'WARNING': 'yellow',
            'ERROR': 'red',
            'CRITICAL': 'red,bg_white',
        }
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)

get_java_version_class = b'\xca\xfe\xba\xbe\x00\x03\x00-\x00,\x08\x00!\x08\x00"\x08\x00#\x08\x00(\x08\x00+\x07\x00\x1a\x07\x00$\x07\x00%\x07\x00&\n\x00\x08\x00\x0e\n\x00\t\x00\x0f\t\x00\t\x00\x10\n\x00\x07\x00\x11\x0c\x00\x16\x00\x12\x0c\x00 \x00\x13\x0c\x00)\x00\x1d\x0c\x00*\x00\x14\x01\x00\x03()V\x01\x00&(Ljava/lang/String;)Ljava/lang/String;\x01\x00\x15(Ljava/lang/String;)V\x01\x00\x16([Ljava/lang/String;)V\x01\x00\x06<init>\x01\x00\x04Code\x01\x00\rConstantValue\x01\x00\nExceptions\x01\x00\x0eGetJavaVersion\x01\x00\x13GetJavaVersion.java\x01\x00\x0fLineNumberTable\x01\x00\x15Ljava/io/PrintStream;\x01\x00\x0eLocalVariables\x01\x00\nSourceFile\x01\x00\x0bgetProperty\x01\x00\x1ajava.specification.version\x01\x00\x0cjava.version\x01\x00\x0cjava.vm.name\x01\x00\x13java/io/PrintStream\x01\x00\x10java/lang/Object\x01\x00\x10java/lang/System\x01\x00\x04main\x01\x00\x07os.arch\x01\x00\x03out\x01\x00\x07println\x01\x00\x13sun.arch.data.model\x00!\x00\x06\x00\x08\x00\x00\x00\x00\x00\x02\x00\t\x00\'\x00\x15\x00\x01\x00\x17\x00\x00\x00d\x00\x02\x00\x01\x00\x00\x008\xb2\x00\x0c\x12\x01\xb8\x00\x0b\xb6\x00\r\xb2\x00\x0c\x12\x05\xb8\x00\x0b\xb6\x00\r\xb2\x00\x0c\x12\x02\xb8\x00\x0b\xb6\x00\r\xb2\x00\x0c\x12\x04\xb8\x00\x0b\xb6\x00\r\xb2\x00\x0c\x12\x03\xb8\x00\x0b\xb6\x00\r\xb1\x00\x00\x00\x01\x00\x1c\x00\x00\x00\x1a\x00\x06\x00\x00\x00\x04\x00\x0b\x00\x05\x00\x16\x00\x06\x00!\x00\x07\x00,\x00\x08\x007\x00\x03\x00\x01\x00\x16\x00\x12\x00\x01\x00\x17\x00\x00\x00\x1d\x00\x01\x00\x01\x00\x00\x00\x05*\xb7\x00\n\xb1\x00\x00\x00\x01\x00\x1c\x00\x00\x00\x06\x00\x01\x00\x00\x00\x02\x00\x01\x00\x1f\x00\x00\x00\x02\x00\x1b'

PATHSEP = os.path.sep
O_PATHSEP = posixpath.sep
SYS_NAME = "windows" 
QUOT = '"'

# 从配置文件读取RAM设置
def get_launcher_ram():
    try:
        with open("config.json", "r") as config_file:
            config = json.load(config_file)
            return config.get("launcher_ram", 4096)  # 默认4GB
    except (FileNotFoundError, json.JSONDecodeError):
        writelog("Error: Failed to read RAM settings, using default value")
        return 4096  # 如果无法读取配置，使用默认值
    
Launcher_RAM = get_launcher_ram()

class InstanceInfo:
    class File:
        def __init__(self, json_data: dict):
            self.url = str(json_data.get("url", ""))
            self.sha1 = str(json_data.get("sha1", ""))
            self.size = int(json_data.get("size", 0))
            self.path = str(json_data.get("path", ""))

    class Rule:
        class Feature:
            def __init__(self, name: str, value: bool):
                self.name = name
                self.value = value

        def __init__(self, json_data: dict):
            self.allow_action = json_data.get("action") == "allow"
            os_data = json_data.get("os", {})
            self.os_name = str(os_data.get("name", ""))
            self.os_version = str(os_data.get("version", ""))
            self.features = {k: bool(v) for k, v in json_data.get("features", {}).items()}

        def is_allowed(self, features):
            allow = (self.os_name == SYS_NAME or self.os_name == "")
            if not self.allow_action:
                allow = not allow
            for feature_name, required_value in self.features.items():
                feature = next((f for f in features if f.name == feature_name), None)
                if feature is None:
                    allow = allow and not required_value
                elif feature.value != required_value:
                    allow = False
            return allow

    class LibraryItem:
        def __init__(self, json_data: dict):
            self.name = str(json_data["name"])
            self.artifact = InstanceInfo.File({})
            self.classifiers = {}
            self.native_names = {}
            self.rules = []
            if "natives" in json_data:
                self.native_names = {os_name: str(native) for os_name, native in json_data["natives"].items()}
            if "downloads" in json_data:
                downloads = json_data["downloads"]
                if "artifact" in downloads:
                    self.artifact = InstanceInfo.File(downloads["artifact"])
                if "classifiers" in downloads:
                    self.classifiers = {self.native_names[os_name]: InstanceInfo.File(classifier)
                                        for os_name, classifier in downloads["classifiers"].items()}
            if "rules" in json_data:
                self.rules = [InstanceInfo.Rule(rule) for rule in json_data["rules"]]

        def try_extract_natives(self, game_dir: str, native_path: str):
            if not self.native_names:
                return False
            native_file = os.path.join(game_dir, "libraries", self.classifiers[self.native_names[SYS_NAME]].path)
            native_file = native_file.replace(O_PATHSEP, PATHSEP)
            try:
                with zipfile.ZipFile(native_file, 'r') as zip_ref:
                    for file in zip_ref.namelist():
                        if file.endswith('.dll'):
                            zip_ref.extract(file, native_path)
                return True
            except (FileNotFoundError, zipfile.BadZipFile):
                writelog(f"Error: Unable to extract natives from {native_file}")
                return False

        def lib_name(self):
            parts = self.name.split(":")
            parts.insert(2, "")
            return ":".join(parts)

        def final_lib_path(self):
            if self.artifact.path:
                lib_path = os.path.join("libraries", self.artifact.path)
            elif self.native_names:
                lib_path = os.path.join("libraries", self.classifiers[self.native_names[SYS_NAME]].path)
            else:
                parts = self.name.split(":")
                parts[0] = parts[0].replace(".", PATHSEP)
                lib_path = os.path.join("libraries", *parts, f"{parts[1]}-{parts[2]}.jar")
            return lib_path.replace(O_PATHSEP, PATHSEP)

        def is_allowed(self, features):
            return all(rule.is_allowed(features) for rule in self.rules)

    class ArgumentItem:
        def __init__(self, json_data):
            self.values = []
            self.rules = []
            if isinstance(json_data, str):
                self.values = [json_data]
            else:
                self.values = json_data.get("value", [])
                if isinstance(self.values, str):
                    self.values = [self.values]
                if "rules" in json_data:
                    self.rules = [InstanceInfo.Rule(rule) for rule in json_data["rules"]]

        def is_allowed(self, features):
            return all(rule.is_allowed(features) for rule in self.rules)

    def __init__(self, json_path: str):
        with open(json_path, 'r') as json_file:
            info = json.load(json_file)
        self.init(info)

    def init(self, info):
        self.id = info["id"]
        self.main_class = info["mainClass"]
        self.asset_index = self.File(info["assetIndex"])
        self.asset_index_total_size = info["assetIndex"]["totalSize"]
        self.asset_index_id = info["assetIndex"]["id"]
        self.compliance_level = info["complianceLevel"]
        self.java_version = info["javaVersion"]["majorVersion"]
        downloads = info["downloads"]
        if "client_mappings" in downloads:
            self.client_mappings = self.File(downloads["client_mappings"])
            self.server_mappings = self.File(downloads["server_mappings"])
        self.client = self.File(downloads["client"])
        self.server = self.File(downloads["server"])
        if "logging" in info:
            if "client" in info["logging"]:
                self.logging_file = self.File(info["logging"]["client"]["file"])
                self.logging_id = info["logging"]["client"]["file"]["id"]
                self.logging_argument = info["logging"]["client"]["argument"]
        else:
            self.logging_file = InstanceInfo.File({})
            self.logging_id = ""
            self.logging_argument = ""
        self.game_type = info["type"]
        if "arguments" in info:
            self.game_arguments = [self.ArgumentItem(arg) for arg in info["arguments"]["game"]]
            self.jvm_arguments = [self.ArgumentItem(arg) for arg in info["arguments"]["jvm"]]
        if "minecraftArguments" in info:
            self.legacy_game_arguments = info["minecraftArguments"]
            self.jvm_arguments = [self.ArgumentItem("-cp"), self.ArgumentItem("${classpath}")]

        self.patches = None # HMCL
        self.libraries = [self.LibraryItem(lib) for lib in info["libraries"]]
        if ("imagine_launcher_cfg" in info):
            self.config = info['imagine_launcher_config']

    def generate_launch_command(self, game_dir: str, selected_account: int, features: list):
        writelog(f"Generating launch command: {self.id}, \"{game_dir}\".")
        version_path = os.path.join("versions", self.id, self.id)
        native_path = os.path.join(game_dir, version_path + "-natives")
        os.makedirs(native_path, exist_ok=True)
        writelog("Generating classpath.")
        cp = self.generate_classpath(game_dir, version_path, native_path, features)
        writelog("Classpath is ready.")
        final_java = self.find_java()
        writelog(f"Found Java \"{final_java}\".")
        #* 重新登录账户
        writelog("Relogging-in the account.")
        
        wid, hei = rdata("WindowWidth"), rdata("WindowHeight")
        game_values = {
            "${version_name}": QUOT + self.id + QUOT,
            "${game_directory}": QUOT + game_dir.replace("\\", "\\\\") + QUOT,
            "${assets_root}": "assets",
            "${assets_index_name}": self.asset_index_id,
            "${version_type}": self.game_type,
            "${auth_access_token}": rdata("Accounts")[selected_account]["userToken"],
            "${auth_session}": rdata("Accounts")[selected_account]["userToken"],
            "${auth_player_name}": rdata("Accounts")[selected_account]["userName"],
            "${auth_uuid}": rdata("Accounts")[selected_account]["userId"],
            "${clientId}": rdata("Accounts")[selected_account]["userId"],
            "${client_id}": rdata("Accounts")[selected_account]["userId"],
            "${user_type}": "msa" if rdata("Accounts")[selected_account]["userType"] == "mojang" else "legacy",
            "${resolution_width}": str(wid),
            "${resolution_height}": str(hei),
            "${natives_directory}": native_path,
            "${user_properties}": "{}",
            "${classpath_separator}": ";",
            "${library_directory}": "libraries\\"
        }
        jvm_values = {
            "${classpath}": cp,
            "${natives_directory}": native_path,
            "${launcher_name}": "Imagine Launcher",
            "${launcher_version}": "0.0.1Alpha"
        }
        writelog("Generating JVM arguments.")
        jvm_args = self.generate_jvm_args(features, jvm_values)
        writelog("Generating game arguments.")
        game_args = self.generate_game_args(features, game_values)
        writelog("Connecting the arguments.")
        if not game_args:
            return ""
        output = f"{QUOT}{final_java}{QUOT}"
        if "-Djava.library.path" not in jvm_args:
            output += f" \"-Djava.library.path={native_path}\""
        if self.logging_argument:
            output += f" {self.logging_argument.replace('${path}', QUOT + os.path.join('versions', self.id, self.logging_id) + QUOT)}"
        output += f" -Xmn{Launcher_RAM}m -XX:+UseG1GC -XX:-UseAdaptiveSizePolicy -XX:-OmitStackTraceInFastThrow -Dlog4j2.formatMsgNoLookups=true"
        output += f" {jvm_args} {self.main_class} {game_args}"
        writelog("Finished generating launch command.")
        return output          
        
    def generate_classpath(self, game_dir: str, version_path: str, native_path: str, features: list):
        available = {}
        for library in self.libraries:
            if library.is_allowed(features):
                if not library.try_extract_natives(game_dir, native_path):
                    available[library.lib_name()] = library.final_lib_path()
        return ";".join(list(available.values()) + [f"\"{version_path}.jar\""])

    def generate_jvm_args(self, features: list, jvm_values: dict):
        jvm_args = []
        for argument in self.jvm_arguments:
            if argument.is_allowed(features):
                for value in argument.values:
                    parts = [jvm_values.get(part, part) for part in value.split("=")]
                    arg = "=".join(parts)
                    jvm_args.append(f"\"{arg}\"" if " " in arg else arg)
        return " ".join(jvm_args)

    def generate_game_args(self, features: list, game_values: dict):
        if self.game_arguments:
            game_args = []
            flag_optifine_forge = False
            flag_forge = False
            flag_optifine = False
            flag_tweak_class = False
            for argument in self.game_arguments:
                if argument.is_allowed(features):
                    for value in argument.values:
                        if value in game_values:
                            value = game_values[value]
                        if value == "--tweakClass":
                            flag_tweak_class = True
                            continue
                        if flag_tweak_class:
                            if value == "net.minecraftforge.fml.common.launcher.FMLTweaker":
                                game_args.append("--tweakClass")
                                flag_forge = True
                            elif value == "optifine.OptiFineForgeTweaker":
                                flag_optifine_forge = True
                            elif value == "optifine.OptiFineTweaker":
                                flag_optifine = True
                            flag_tweak_class = False
                            continue
                        game_args.append(f"\"{value}\"" if " " in value else value)
            if (flag_optifine and flag_forge) or flag_optifine_forge:
                game_args.append("--tweakClass")
                game_args.append("optifine.OptiFineForgeTweaker")
            return " ".join(game_args)
        elif self.legacy_game_arguments:
            game_args = self.legacy_game_arguments
            for key, value in game_values.items():
                game_args = game_args.replace(key, value)
            if " --tweakClass optifine.OptiFineForgeTweaker" in game_args:
                game_args = game_args.replace(" --tweakClass optifine.OptiFineForgeTweaker", "")
                game_args += " --tweakClass optifine.OptiFineForgeTweaker"
            elif " --tweakClass net.minecraftforge.fml.common.launcher.FMLTweaker" in game_args:
                if " --tweakClass optifine.OptiFineTweaker" in game_args:
                    game_args = game_args.replace(" --tweakClass optifine.OptiFineTweaker", "")
                    game_args += " --tweakClass optifine.OptiFineForgeTweaker"
            return game_args
        else:
            call(["msgbx", "error", "minecraft.no_args", "error"])
            return ""

    def find_java(self):
        java_version = self.java_version
        #a = VersionInfo("H:\\Minecraft\\.minecraft\\versions\\1.20.1\\1.20.1.json");a.generate_launch_command("H:\\Minecraft\\.minecraft\\", 0, [])
        java_version = 21 if java_version > 17 else (17 if java_version > 11 else 8)
        javas = rdata("Javas")
        selected_java = rdata("SelectedJava")
        if selected_java < 0:
            for java in javas:
                try:
                    java_info = subprocess.getoutput(f"\"{java}\" GetJavaVersion").split("\n")
                    print(java_info)
                    if java_info[1] != "64": continue
                    cur_version = 0
                    n = 2 if java_info[0][1] == '.' else 0
                    print(n)
                    m = java_info[0][n:].find('.')
                    if m == -1: m = None
                    cur_version = int(java_info[0][n:m])
                    cur_version = 21 if cur_version > 17 else (17 if cur_version > 11 else 8)
                    if cur_version == java_version:
                        return java
                except (subprocess.CalledProcessError, IndexError):
                    continue
        else:
            return javas[selected_java]
        return ""

# Some self-created parts
def writelog(message):
    print(f"[LOG] {message}")
    with open("application.log", "a") as log_file:
        log_file.write(f"[LOG] {message}\n")

def rdata(key):
    try:
        with open("config.json", "r") as config_file:
            data = json.load(config_file)
            return data.get(key, {})
    except FileNotFoundError:
        writelog(f"Error: Configuration file not found.")
        logging.ERROR("Error: Configuration file not found.")
        return {}
    except json.JSONDecodeError:
        writelog(f"Error: Failed to decode JSON from configuration file.")
        logging.ERROR("Error: Failed to decode JSON from configuration file.")
        return {}
    
def call(args):
    try:
        result = subprocess.run(args, check=True, capture_output=True, text=True)
        if result.stdout:
            writelog(f"Output: {result.stdout}")
            logging.INFO(f"Command '{' '.join(args)}' executed successfully.")
        if result.stderr:
            writelog(f"Error: {result.stderr}")
            logging.ERROR(f"Error: Command '{' '.join(args)}' failed with exit code {e.returncode}.")
    except subprocess.CalledProcessError as e:
        writelog(f"Error: Command '{' '.join(args)}' failed with exit code {e.returncode}.")
        logging.ERROR(f"Error: Command '{' '.join(args)}' failed with exit code {e.returncode}.")


'''
Powered by ZZBuAoYe_
Translation on the basis of HiHill
2024/08/18
For RMCLauncher
'''
