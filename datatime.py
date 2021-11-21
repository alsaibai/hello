#function to get today date with time in milliseconds
import time
def get_today_date_time_millis():
    return int(time.time() * 1000)

#call function to get today date with time in milliseconds
print(get_today_date_time_millis())
