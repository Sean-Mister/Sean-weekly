from flask import Flask
from flask_socketio import SocketIO
import redis
from configs.auth import REDIS_HOST,REDIS_PORT,REDIS_DB


class CustomFlask(Flask):
    jinja_options = Flask.jinja_options.copy()
    jinja_options.update(dict(
        variable_start_string='[[',  # Default is '{{', I'm changing this because Vue.js uses '{{' / '}}'
        variable_end_string=']]',
    ))


# 定义作为web服务器常用的公用实例对象 方便其余程序直接import
app = CustomFlask('WeixinCrawler',template_folder="./ui/templates",static_folder="./ui/static")
# app = CustomFlask('WeixinCrawler',template_folder="./templates",static_folder="./static")
app.config['SECRET_KEY'] = 'secret!'

def create_socketio(flask_app):
    for mode in ("gevent", "eventlet", "threading"):
        try:
            return SocketIO(flask_app, async_mode=mode)
        except ValueError:
            continue
    return SocketIO(flask_app)

socketio = create_socketio(app)
the_redis = redis.StrictRedis(host=REDIS_HOST, port=REDIS_PORT, db=REDIS_DB)
