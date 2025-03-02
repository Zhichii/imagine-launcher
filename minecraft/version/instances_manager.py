# Manage Minecraft instances

import os
from minecraft.version.instance_info import InstanceInfo, get_launcher_ram

# 我不会处理，麻烦弄一下（
DEFAULT_MINECRAFT_FOLDER = 'H:\\Minecraft\\.minecraft\\'

class InstancesManager():
    def __init__(self):
        self.config = self.load_config()
        self.minecraft_folder = self.config.get('minecraft_folder', DEFAULT_MINECRAFT_FOLDER) # 以\\结尾
        self.launcher_ram = get_launcher_ram
    def get_instances(self):
        x = os.listdir(self.minecraft_folder)
        for i in x:
            try:
                info = InstanceInfo(self.minecraft_folder+i)
            except Exception as e:
                # 输出日志并显示错误（消息？）
                continue
            

