import os
import json
import psutil
from PySide6.QtCore import QObject, Signal
from core.log.log_manager import log

class RAMManager(QObject):
    # 定义信号
    ram_changed = Signal(int)  # 当RAM设置改变时发出信号
    auto_ram_changed = Signal(bool)  # 当自动RAM设置状态改变时发出信号
    
    def __init__(self, config_file='config.json'):
        super().__init__()
        self.config_file = config_file
        # 先获取系统内存，再加载设置
        self.system_memory = self._get_system_memory()
        self.settings = self._load_settings()
        
    def _load_config(self):
        config = {}
        try:
            if os.path.exists(self.config_file):
                with open(self.config_file, 'r', encoding='utf-8') as f:
                    config = json.load(f)
        except Exception as e:
            log.error(f"加载配置文件出错: {str(e)}")
        return config

    def _save_config(self, config):
        try:
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=4, ensure_ascii=False)
            return True
        except Exception as e:
            log.error(f"保存配置文件出错: {str(e)}")
            return False

    def _load_settings(self):
        default_settings = {
            'launcher_ram': 1024,  # 默认分配1GB RAM
            'auto_ram': False      # 默认不启用自动RAM设置
        }
        
        config = self._load_config()
        # 合并默认设置和配置文件中的设置
        merged_settings = {**default_settings, **config}
        
        # 确保RAM设置不超过系统内存
        if merged_settings['launcher_ram'] > self.system_memory:
            merged_settings['launcher_ram'] = min(self.system_memory, 4096)  # 默认最大4GB
            
        return merged_settings

    def _get_system_memory(self):
        try:
            # 使用psutil获取系统内存信息
            memory_info = psutil.virtual_memory()
            # 转换为MB并返回
            return int(memory_info.total / (1024 * 1024))
        except Exception as e:
            log.error(f"获取系统内存信息失败: {str(e)}")
            # 如果获取失败，返回一个默认值（8GB）
            return 8192
    
    def get_formatted_memory(self, bytes_value):
        try:
            if bytes_value >= (1024 * 1024 * 1024):
                return round(bytes_value / (1024 * 1024 * 1024), 2), 'GB'
            elif bytes_value >= (1024 * 1024):
                return round(bytes_value / (1024 * 1024), 2), 'MB'
            else:
                return bytes_value, 'KB'
        except Exception as e:
            log.error(f"格式化内存大小失败: {str(e)}")
            return "N/A", 'GB'
    
    def get_ram_size(self):
        # 如果启用了自动RAM设置，则计算最佳RAM值
        if self.settings.get('auto_ram', False):
            return self.calculate_optimal_ram()
        return self.settings.get('launcher_ram', 1024)
    
    def get_system_memory(self):
        return self.system_memory
    
    def set_ram_size(self, size_mb):
        # 如果启用了自动RAM设置，则不允许手动设置RAM大小
        if self.settings.get('auto_ram', False):
            return False
            
        # 确保RAM设置在合理范围内
        size_mb = max(512, min(size_mb, self.system_memory))  # 使用max/min简化范围限制
            
        # 更新设置
        self.settings['launcher_ram'] = size_mb
        
        # 保存到配置文件
        config = self._load_config()
        config['launcher_ram'] = size_mb
        success = self._save_config(config)
        
        if success:
            # 发出信号通知RAM设置已更改
            self.ram_changed.emit(size_mb)
            
        return success
    
    def get_auto_ram(self):
        return self.settings.get('auto_ram', False)
    
    def set_auto_ram(self, enabled):
        # 更新设置
        self.settings['auto_ram'] = enabled
        
        # 保存到配置文件
        config = self._load_config()
        config['auto_ram'] = enabled
        success = self._save_config(config)
        
        if success:
            # 发出信号通知自动RAM设置状态已更改
            self.auto_ram_changed.emit(enabled)
            
            # 如果启用了自动RAM，立即计算并应用最佳RAM值
            if enabled:
                optimal_ram = self.calculate_optimal_ram()
                # 更新设置但不触发set_ram_size（因为它会在自动模式下返回False）
                self.settings['launcher_ram'] = optimal_ram
                config['launcher_ram'] = optimal_ram
                self._save_config(config)
                # 手动发出RAM变更信号
                self.ram_changed.emit(optimal_ram)
                
        return success
    
    def calculate_optimal_ram(self):
        try:
            # 获取系统内存信息
            memory_info = psutil.virtual_memory()
            total_ram = self.system_memory
            available_ram = int(memory_info.available / (1024 * 1024))
            
            # 优化计算逻辑：先计算基于总内存和可用内存的两个值，然后取较小值
            ram_by_available = int(available_ram * 0.7)
            ram_by_total = int(total_ram * 0.4)
            allocatable_ram = min(ram_by_available, ram_by_total)
            
            # 使用一行代码处理范围限制和128MB对齐
            optimal_ram = max(1024, min(allocatable_ram, 8192))
            optimal_ram = (optimal_ram // 128) * 128
            
            return optimal_ram
        except Exception as e:
            log.error(f"计算最佳RAM值失败: {str(e)}")
            return self.get_recommended_ram()
    
    def get_recommended_ram(self):
        # 推荐为系统内存的1/4，但不少于1GB，不超过4GB
        return max(1024, min(int(self.system_memory / 4), 4096))
    
    def get_max_allowed_ram(self):
        # 通常不建议超过系统内存的一半
        return min(self.system_memory, 16384)  # 最大16GB
    
    def get_min_allowed_ram(self):
        return 512  # 最小512MB
    
    def get_used_ram(self):
        try:
            memory_info = psutil.virtual_memory()
            return int(memory_info.used / (1024 * 1024))
        except Exception as e:
            log.error(f"获取已使用内存信息失败: {str(e)}")
            return 0
    
    def get_available_ram(self):
        try:
            memory_info = psutil.virtual_memory()
            return int(memory_info.available / (1024 * 1024))
        except Exception as e:
            log.error(f"获取可用内存信息失败: {str(e)}")
            return self.system_memory // 2  
